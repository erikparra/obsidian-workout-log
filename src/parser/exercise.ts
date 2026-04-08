import { Exercise, ExerciseState, ParameterToken } from '../types';

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

// Tokenizer for parsing exercise line
// Format: - [STATE] Exercise Name | Param: value | Param2: [value] unit
function tokenizeExerciseLine(line: string): {
	stateChar: string;
	remainder: string; 
} | null {
	// Must start with "- ["
	if (!line.startsWith('- [')) return null;

	// Find closing bracket
	const closeBracketIdx = line.indexOf(']', 3);
	if (closeBracketIdx === -1) return null;

	const stateChar = line[3] ?? '';

	// Remainder is everything after "] "
	const spaceAfterBracket = closeBracketIdx + 1;
	if (spaceAfterBracket >= line.length || line[spaceAfterBracket] !== ' ') return null;

	const remainder = line.substring(spaceAfterBracket + 1);
	return { stateChar, remainder: remainder };
}

// Parse value with optional brackets: [value] = editable, value = locked
// Also handle Duration special case for timer
export function parseExercise(line: string, lineIndex: number): Exercise | null {
	const parsed = tokenizeExerciseLine(line);
	if (!parsed) return null;

	const state = STATE_MAP[parsed.stateChar];
	if (!state) return null;

	// Split by | to get name and params
	const parts = parsed.remainder.split('|').map(p => p.trim());
	const name = parts[0] ?? '';
	const paramStrings = parts.slice(1);

	const params: ParameterToken[] = [];
	let targetDuration: number | undefined;
	let recordedDuration: string | undefined;

	for (const paramStr of paramStrings) {
		const param = tokenizeParam(paramStr);
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
		targetDuration,
		recordedDuration,
		lineIndex
	};
}


function tokenizeParam(paramStr: string): ParameterToken | null {
	// Handle simple format: Key: value or Key: [value] or Key: [value] unit
	const colonIndex = paramStr.indexOf(':');
	if (colonIndex === -1) return null;

	const key = paramStr.substring(0, colonIndex).trim();
	const rest = paramStr.substring(colonIndex + 1).trim();

	// Check for bracketed value using indexOf
	const openBracketIdx = rest.indexOf('[');
	if (openBracketIdx === 0) {
		// Has brackets
		const closeBracketIdx = rest.indexOf(']', 1);
		if (closeBracketIdx === -1) return null;

		const value = rest.substring(1, closeBracketIdx);
		const afterBracket = rest.substring(closeBracketIdx + 1).trim();

		return {
			key,
			value,
			editable: true,
			unit: afterBracket || undefined
		};
	}

	// No brackets - find first space for value and unit
	const spaceIdx = rest.indexOf(' ');
	let value: string;
	let unit: string | undefined;

	if (spaceIdx === -1) {
		// No space = just value
		value = rest;
	} else {
		value = rest.substring(0, spaceIdx);
		unit = rest.substring(spaceIdx + 1).trim() || undefined;
	}

	return {
		key,
		value,
		editable: false,
		unit
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
