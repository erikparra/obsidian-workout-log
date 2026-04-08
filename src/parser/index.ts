import { ParsedWorkout, Exercise, ExerciseSet } from '../types';
import { parseMetadata } from './metadata';
import { parseExercise, parseSet } from './exercise';

export function parseWorkout(source: string): ParsedWorkout {
	const rawLines = source.split('\n');

	// Find the separator between metadata and exercises
	let separatorIndex = -1;
	for (let i = 0; i < rawLines.length; i++) {
		if (rawLines[i]?.trim() === '---') {
			separatorIndex = i;
			break;
		}
	}

	// Parse metadata (lines before ---)
	const metadataLines = separatorIndex > 0
		? rawLines.slice(0, separatorIndex)
		: [];
	const metadata = parseMetadata(metadataLines);

	// Parse exercises (lines after ---), handling nested sets
	const exerciseStartIndex = separatorIndex >= 0 ? separatorIndex + 1 : 0;
	const exerciseLines = rawLines.slice(exerciseStartIndex);

	const exercises: Exercise[] = [];
	let currentExercise: Exercise | null = null;

	for (let i = 0; i < exerciseLines.length; i++) {
		const line = exerciseLines[i];
		if (!line || !line.trim()) continue;

		const isIndented = line.match(/^\s+/);

		if (isIndented) {
			// This is a set (indented line)
			if (currentExercise) {
				const set = parseSet(line, i);
				if (set) {
					currentExercise.sets.push(set);
				}
			}
		} else {
			// This is a parent exercise (no indent)
			// Save previous exercise if it has no sets, create a default one
			if (currentExercise && currentExercise.sets.length === 0) {
				currentExercise.sets.push({
					state: currentExercise.state,
					params: currentExercise.params,
					lineIndex: currentExercise.lineIndex
				});
				currentExercise.params = [];
			}

			const exercise = parseExercise(line, i);
			if (exercise) {
				currentExercise = {
					...exercise,
					sets: []
				};
				exercises.push(currentExercise);
			}
		}
	}

	// Handle last exercise: if it has no sets, create one from its params
	if (currentExercise && currentExercise.sets.length === 0) {
		currentExercise.sets.push({
			state: currentExercise.state,
			params: currentExercise.params,
			lineIndex: currentExercise.lineIndex
		});
		currentExercise.params = [];
	}

	return {
		metadata,
		exercises,
		rawLines,
		metadataEndIndex: separatorIndex >= 0 ? separatorIndex : -1
	};
}

export { parseMetadata, serializeMetadata } from './metadata';
export { parseExercise, parseSet, serializeExercise, serializeSet, formatDuration, formatDurationHuman, parseDurationToSeconds, getStateChar } from './exercise';
