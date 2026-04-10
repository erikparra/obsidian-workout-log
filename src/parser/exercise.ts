import { Exercise, ExerciseSet, ExerciseState, ExerciseParam, Token } from '../types';

// Checkbox patterns: [ ] pending, [\] inProgress, [x] completed, [-] skipped
const STATE_MAP: Record<string, ExerciseState> = {
	' ': 'pending',
	'\\': 'inProgress',
	'x': 'completed',
	'-': 'skipped'
};

const STATE_CHAR_MAP: Record<ExerciseState, string> = {
	'pending': ' ',
	'inProgress': '\\',
	'completed': 'x',
	'skipped': '-'
};

function tokenizeExerciseLine(line: string): { stateChar: string; remainder: string } | null {
	// Check for leading dash
	if (!line.startsWith('-')) return null;

	// Find opening bracket
	const openBracketIndex = line.indexOf('[');
	if (openBracketIndex === -1) return null;

	// Find closing bracket
	const closeBracketIndex = line.indexOf(']', openBracketIndex);
	if (closeBracketIndex === -1) return null;

	// Extract state character
	const stateChar = line.substring(openBracketIndex + 1, closeBracketIndex);
	if (stateChar.length !== 1) return null;

	// Get remainder after closing bracket
	const afterBracket = line.substring(closeBracketIndex + 1).trimStart();
	if (!afterBracket) return null;

	return { stateChar, remainder: afterBracket };
}

export function parseExercise(line: string, lineIndex: number): Exercise | null {
	const tokenized = tokenizeExerciseLine(line);
	if (!tokenized) return null;

	const state = STATE_MAP[tokenized.stateChar] ?? 'pending';

	// Split by | to get name and params
	const parts = tokenized.remainder.split('|').map(p => p.trim());
	const name = parts[0] ?? '';
	const paramStrings = parts.slice(1);

	const params: ExerciseParam[] = [];
	let targetDuration: number | undefined;
	let recordedDuration: string | undefined;

	for (const paramStr of paramStrings) {
		const param = parseParam(paramStr);
		if (param) {
			params.push(param);

			// Special handling for Duration key
			if (param.key.toLowerCase() === 'duration') {
				if (param.editable) {
					// Editable duration = countdown target
					targetDuration = parseDurationToSeconds(param.value);
				} else {
					// Locked duration = recorded time
					recordedDuration = param.value + (param.unit ? ` ${param.unit}` : '');
				}
			}
		}
	}

	return {
		state,
		name,
		params,
		sets: [],
		targetDuration,
		recordedDuration,
		lineIndex
	};
}

export function parseSet(line: string, lineIndex: number): ExerciseSet | null {
	const trimmed = line.trim();
	const tokenized = tokenizeExerciseLine(trimmed);
	if (!tokenized) return null;

	const state = STATE_MAP[tokenized.stateChar] ?? 'pending';

	// Split by | to get params (no name for sets)
	const parts = tokenized.remainder.split('|').map(p => p.trim());
	const paramStrings = parts;

	const params: ExerciseParam[] = [];
	let recordedDuration: string | undefined;
	let recordedRest: string | undefined;

	for (const paramStr of paramStrings) {
		const param = parseParam(paramStr);
		if (param) {
			// Extract recorded times without adding them to params
			if (param.key.toLowerCase() === '~time') {
				recordedDuration = param.value;
				// Don't add to params - these are computed values
			} else if (param.key.toLowerCase() === '~rest') {
				recordedRest = param.value;
				// Don't add to params - these are computed values
			} else {
				params.push(param);
			}
		}
	}

	return {
		state,
		params,
		lineIndex,
		recordedDuration,
		recordedRest
	};
}

function tokenizeParam(paramStr: string): Token[] {
	const tokens: Token[] = [];

	// 1. Parse key (everything before colon)
	const colonIndex = paramStr.indexOf(':');
	if (colonIndex === -1) return [];

	const key = paramStr.substring(0, colonIndex).trim();
	tokens.push({ type: 'key', value: key });

	// 2. Parse value and unit (after colon)
	let remainder = paramStr.substring(colonIndex + 1).trim();

	// Check for bracketed value
	if (remainder.startsWith('[')) {
		const closeBracketIndex = remainder.indexOf(']');
		if (closeBracketIndex !== -1) {
			const value = remainder.substring(1, closeBracketIndex);
			tokens.push({ type: 'bracket', value });
			remainder = remainder.substring(closeBracketIndex + 1).trim();
		}
	} else if (remainder.length > 0) {
		// Unbracketed value - read until space
		const spaceIndex = remainder.indexOf(' ');
		if (spaceIndex === -1) {
			// No space - check if value and unit are concatenated (e.g., "10s", "60m")
			let numericEnd = 0;
			for (let i = 0; i < remainder.length; i++) {
				const char = remainder.charAt(i);
				if (char === '.' || (char >= '0' && char <= '9')) {
					numericEnd = i + 1;
				} else {
					break;
				}
			}

			if (numericEnd > 0 && numericEnd < remainder.length) {
				// Has both numeric value and non-numeric unit
				tokens.push({ type: 'value', value: remainder.substring(0, numericEnd) });
				remainder = remainder.substring(numericEnd);
			} else {
				// No unit attached or all numeric, entire remainder is value
				tokens.push({ type: 'value', value: remainder });
				return tokens;
			}
		} else {
			tokens.push({ type: 'value', value: remainder.substring(0, spaceIndex) });
			remainder = remainder.substring(spaceIndex).trim();
		}
	}

	// 3. Parse unit (whatever remains)
	if (remainder) {
		tokens.push({ type: 'unit', value: remainder });
	}

	return tokens;
}

function parseParam(paramStr: string): ExerciseParam | null {
	const tokens = tokenizeParam(paramStr);
	if (tokens.length === 0) return null;

	const keyToken = tokens.find(t => t.type === 'key');
	const valueToken = tokens.find(t => t.type === 'bracket' || t.type === 'value');

	if (!keyToken || !valueToken) return null;

	// Only allow these parameters - all others are ignored
	// ~time and ~rest are system-managed totals (not user-editable)
	const allowedParams = ['duration', 'weight', 'reps', 'rest', '~time', '~rest'];
	const paramKeyLower = keyToken.value.toLowerCase();
	if (!allowedParams.includes(paramKeyLower)) {
		return null; // Ignore unrecognized parameters
	}

	const unitToken = tokens.find(t => t.type === 'unit');

	let finalValue = valueToken.value;
	let finalUnit = unitToken?.value;

	// For Duration, ~time, and ~rest, combine value and unit since they're part of duration syntax (e.g., "3m2s")
	if ((keyToken.value.toLowerCase() === 'duration' || keyToken.value.toLowerCase() === '~time' || keyToken.value.toLowerCase() === '~rest') && finalUnit) {
		finalValue = finalValue + finalUnit;
		finalUnit = undefined;
	}

	return {
		key: keyToken.value,
		value: finalValue,
		editable: valueToken.type === 'bracket',
		unit: finalUnit
	};
}

// Parse duration string like "60s", "1:30", "1m 30s" to seconds
export function parseDurationToSeconds(durationStr: string): number {
	const str = durationStr.trim();

	// Format: 60s
	const secondsMatch = str.match(/^(\d+)s$/);
	if (secondsMatch) {
		return parseInt(secondsMatch[1] ?? '0', 10);
	}

	// Format: 1:30 or 01:30
	const colonMatch = str.match(/^(\d+):(\d{2})$/);
	if (colonMatch) {
		const mins = parseInt(colonMatch[1] ?? '0', 10);
		const secs = parseInt(colonMatch[2] ?? '0', 10);
		return mins * 60 + secs;
	}

	// Format: 1m 30s or 1m30s
	const minSecMatch = str.match(/^(\d+)m\s*(\d+)?s?$/);
	if (minSecMatch) {
		const mins = parseInt(minSecMatch[1] ?? '0', 10);
		const secs = parseInt(minSecMatch[2] ?? '0', 10);
		return mins * 60 + secs;
	}

	// Format: just a number (assume seconds)
	const numMatch = str.match(/^(\d+)$/);
	if (numMatch) {
		return parseInt(numMatch[1] ?? '0', 10);
	}

	return 0;
}

// Format seconds to display string
export function formatDuration(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Format seconds to human readable string (e.g., "11m 33s")
export function formatDurationHuman(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	if (mins === 0) {
		return `${secs}s`;
	}
	if (secs === 0) {
		return `${mins}m`;
	}
	return `${mins}m ${secs}s`;
}

export function getStateChar(state: ExerciseState): string {
	return STATE_CHAR_MAP[state];
}

export function serializeExercise(exercise: Exercise): string {
	const stateChar = getStateChar(exercise.state);
	let line = `- [${stateChar}] ${exercise.name}`;

	for (const param of exercise.params) {
		line += ' | ';
		line += `${param.key}: `;
		if (param.editable) {
			line += `[${param.value}]`;
		} else {
			line += param.value;
		}
		if (param.unit) {
			line += ` ${param.unit}`;
		}
	}

	return line;
}

export function serializeSet(set: ExerciseSet): string {
	const stateChar = getStateChar(set.state);
	let line = `  - [${stateChar}]`;

	for (const param of set.params) {
		line += ' | ';
		line += `${param.key}: `;
		if (param.editable) {
			line += `[${param.value}]`;
		} else {
			line += param.value;
		}
		if (param.unit) {
			line += ` ${param.unit}`;
		}
	}

	return line;
}
