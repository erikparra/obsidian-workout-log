import { ParsedWorkout, Exercise, ExerciseState, ExerciseSet } from './types';
import { serializeMetadata } from './parser/metadata';
import { serializeExercise, serializeSet, getStateChar } from './parser/exercise';

export function serializeWorkout(parsed: ParsedWorkout): string {
	const lines: string[] = [];

	// Serialize metadata
	const metadataLines = serializeMetadata(parsed.metadata);
	lines.push(...metadataLines);

	// Add separator
	lines.push('---');

	// Serialize exercises with their sets
	for (const exercise of parsed.exercises) {
		lines.push(serializeExercise(exercise));
		
		// Serialize sets under the exercise
		for (const set of exercise.sets) {
			lines.push(serializeSet(set));
		}
	}

	return lines.join('\n');
}

// Update a specific param value in a workout (exercise-level params)
export function updateParamValue(
	parsed: ParsedWorkout,
	exerciseIndex: number,
	paramKey: string,
	newValue: string
): ParsedWorkout {
	const newParsed = structuredClone(parsed);
	const exercise = newParsed.exercises[exerciseIndex];
	if (!exercise) return parsed;

	const param = exercise.params.find(p => p.key === paramKey);
	if (param) {
		param.value = newValue;
	}

	return newParsed;
}

// Update a specific param value in a set
export function updateSetParamValue(
	parsed: ParsedWorkout,
	exerciseIndex: number,
	setIndex: number,
	paramKey: string,
	newValue: string
): ParsedWorkout {
	const newParsed = structuredClone(parsed);
	const exercise = newParsed.exercises[exerciseIndex];
	if (!exercise) return parsed;

	const set = exercise.sets[setIndex];
	if (!set) return parsed;

	const param = set.params.find(p => p.key === paramKey);
	if (param) {
		param.value = newValue;
	}

	return newParsed;
}

// Update exercise state
export function updateExerciseState(
	parsed: ParsedWorkout,
	exerciseIndex: number,
	newState: ExerciseState
): ParsedWorkout {
	const newParsed = structuredClone(parsed);
	const exercise = newParsed.exercises[exerciseIndex];
	if (!exercise) return parsed;

	exercise.state = newState;
	return newParsed;
}

// Update set state
export function updateSetState(
	parsed: ParsedWorkout,
	exerciseIndex: number,
	setIndex: number,
	newState: ExerciseState
): ParsedWorkout {
	const newParsed = structuredClone(parsed);
	const exercise = newParsed.exercises[exerciseIndex];
	if (!exercise) return parsed;

	const set = exercise.sets[setIndex];
	if (!set) return parsed;

	set.state = newState;
	return newParsed;
}

// Lock all editable fields (remove brackets)
export function lockAllFields(parsed: ParsedWorkout): ParsedWorkout {
	const newParsed = structuredClone(parsed);

	for (const exercise of newParsed.exercises) {
		for (const param of exercise.params) {
			param.editable = false;
		}
		for (const set of exercise.sets) {
			for (const param of set.params) {
				param.editable = false;
			}
		}
	}

	return newParsed;
}

// Add a rest exercise after the specified index
export function addRest(parsed: ParsedWorkout, exerciseIndex: number, restDuration: number): ParsedWorkout {
	const newParsed = structuredClone(parsed);
	const currentExercise = newParsed.exercises[exerciseIndex];
	if (!currentExercise) return parsed;

	// Create a Rest exercise with countdown duration
	const restExercise: Exercise = {
		state: 'pending',
		name: 'Rest',
		params: [{
			key: 'Duration',
			value: `${restDuration}s`,
			editable: true
		}],
		sets: [],
		targetDuration: restDuration,
		lineIndex: currentExercise.lineIndex + 1
	};

	// Insert after current exercise
	newParsed.exercises.splice(exerciseIndex + 1, 0, restExercise);

	// Update line indices for subsequent exercises
	for (let i = exerciseIndex + 2; i < newParsed.exercises.length; i++) {
		const ex = newParsed.exercises[i];
		if (ex) ex.lineIndex++;
	}

	return newParsed;
}

// Add a new set to an exercise
export function addSet(parsed: ParsedWorkout, exerciseIndex: number): ParsedWorkout {
	const newParsed = structuredClone(parsed);
	const exercise = newParsed.exercises[exerciseIndex];
	if (!exercise || exercise.sets.length === 0) return parsed;

	// Copy the first set as a template
	const firstSet = exercise.sets[0];
	if (!firstSet) return parsed;
	
	const clonedSet = structuredClone(firstSet);
	const newSet: ExerciseSet = {
		state: 'pending',
		params: clonedSet?.params || [],
		lineIndex: (exercise.sets[exercise.sets.length - 1]?.lineIndex || 0) + 1
	};

	// Make values editable again
	for (const param of newSet.params) {
		// Keep Duration params editable for sets
		param.editable = param.key.toLowerCase() === 'duration' || param.editable;
	}

	// Add the new set
	exercise.sets.push(newSet);

	return newParsed;
}

// Set Duration param value (for recording time after exercise completion)
export function setRecordedDuration(
	parsed: ParsedWorkout,
	exerciseIndex: number,
	durationStr: string
): ParsedWorkout {
	const newParsed = structuredClone(parsed);
	const exercise = newParsed.exercises[exerciseIndex];
	if (!exercise) return parsed;

	// Find Duration param or add one
	let durationParam = exercise.params.find(p => p.key.toLowerCase() === 'duration');

	if (durationParam) {
		durationParam.value = durationStr;
		durationParam.editable = false;
	} else {
		// Add Duration param
		exercise.params.push({
			key: 'Duration',
			value: durationStr,
			editable: false
		});
	}

	exercise.recordedDuration = durationStr;
	return newParsed;
}

// Set Duration param value for a specific set
export function setSetRecordedDuration(
	parsed: ParsedWorkout,
	exerciseIndex: number,
	setIndex: number,
	durationStr: string
): ParsedWorkout {
	const newParsed = structuredClone(parsed);
	const exercise = newParsed.exercises[exerciseIndex];
	if (!exercise) return parsed;

	const set = exercise.sets[setIndex];
	if (!set) return parsed;

	// Find Duration param or add one
	let durationParam = set.params.find(p => p.key.toLowerCase() === 'duration');

	if (durationParam) {
		durationParam.value = durationStr;
		durationParam.editable = false;
	} else {
		// Add Duration param
		set.params.push({
			key: 'Duration',
			value: durationStr,
			editable: false
		});
	}

	return newParsed;
}

// Update Rest param value for a specific set
export function updateSetRestDuration(
	parsed: ParsedWorkout,
	exerciseIndex: number,
	setIndex: number,
	restStr: string
): ParsedWorkout {
	const newParsed = structuredClone(parsed);
	const exercise = newParsed.exercises[exerciseIndex];
	if (!exercise) return parsed;

	const set = exercise.sets[setIndex];
	if (!set) return parsed;

	// Find Rest param or add one
	let restParam = set.params.find(p => p.key.toLowerCase() === 'rest');

	if (restParam) {
		restParam.value = restStr;
		restParam.editable = true;
	} else {
		// Add Rest param
		set.params.push({
			key: 'Rest',
			value: restStr,
			editable: true
		});
	}

	return newParsed;
}

// Create a sample workout with comprehensive exercise examples
export function createSampleWorkout(): ParsedWorkout {
	const metadata = {
		title: 'Sample Workout',
		state: 'planned' as const,
		restDuration: 60
	};

	const exercises: Exercise[] = [
		{
			state: 'pending',
			name: 'Squats',
			params: [{ key: 'Duration', value: '[180s]', editable: true }],
			sets: [
				{
					state: 'pending',
					params: [
						{ key: 'Weight', value: '60', editable: true, unit: 'kg' },
						{ key: 'Reps', value: '12', editable: true },
						{ key: 'Rest', value: '[60s]', editable: true }
					],
					lineIndex: 0
				},
				{
					state: 'pending',
					params: [
						{ key: 'Weight', value: '65', editable: true, unit: 'kg' },
						{ key: 'Reps', value: '10', editable: true },
						{ key: 'Rest', value: '[90s]', editable: true }
					],
					lineIndex: 1
				}
			],
			targetDuration: 180,
			lineIndex: 0
		},
		{
			state: 'pending',
			name: 'Rest',
			params: [{ key: 'Duration', value: '60s', editable: true }],
			sets: [
				{
					state: 'pending',
					params: [{ key: 'Duration', value: '60s', editable: true }],
					lineIndex: 2
				}
			],
			targetDuration: 60,
			lineIndex: 3
		},
		{
			state: 'pending',
			name: 'Push-ups',
			params: [],
			sets: [
				{
					state: 'pending',
					params: [
						{ key: 'Reps', value: '15', editable: true },
						{ key: 'Rest', value: '[45s]', editable: true }
					],
					lineIndex: 3
				},
				{
					state: 'pending',
					params: [
						{ key: 'Reps', value: '12', editable: true },
						{ key: 'Rest', value: '[60s]', editable: true }
					],
					lineIndex: 4
				}
			],
			lineIndex: 4
		},
		{
			state: 'pending',
			name: 'Rest',
			params: [{ key: 'Duration', value: '60s', editable: true }],
			sets: [
				{
					state: 'pending',
					params: [{ key: 'Duration', value: '60s', editable: true }],
					lineIndex: 5
				}
			],
			targetDuration: 60,
			lineIndex: 6
		},
		{
			state: 'pending',
			name: 'Dumbbell Rows',
			params: [],
			sets: [
				{
					state: 'pending',
					params: [
						{ key: 'Weight', value: '20', editable: true, unit: 'kg' },
						{ key: 'Reps', value: '10', editable: true, unit: '/arm' },
						{ key: 'Rest', value: '[60s]', editable: true }
					],
					lineIndex: 6
				},
				{
					state: 'pending',
					params: [
						{ key: 'Weight', value: '25', editable: true, unit: 'kg' },
						{ key: 'Reps', value: '8', editable: true, unit: '/arm' },
						{ key: 'Rest', value: '[90s]', editable: true }
					],
					lineIndex: 7
				}
			],
			lineIndex: 7
		}
	];

	return {
		metadata,
		exercises,
		rawLines: [],
		metadataEndIndex: -1
	};
}

// Serialize workout as a clean template (for copying)
export function serializeWorkoutAsTemplate(parsed: ParsedWorkout): string {
	const lines: string[] = [];

	// Metadata - reset to planned, no dates/duration
	if (parsed.metadata.title) {
		lines.push(`title: ${parsed.metadata.title}`);
	}
	lines.push('state: planned');
	lines.push('startDate:');
	lines.push('duration:');

	// Add separator
	lines.push('---');

	// Serialize exercises with their sets
	for (const exercise of parsed.exercises) {
		let exerciseLine = `- [ ] ${exercise.name}`;

		// Add exercise-level params (typically Duration for timed exercises)
		for (const param of exercise.params) {
			exerciseLine += ' | ';
			exerciseLine += `${param.key}: `;

			if (param.key.toLowerCase() === 'duration' && exercise.targetDuration) {
				// Restore original target duration format
				const mins = Math.floor(exercise.targetDuration / 60);
				const secs = exercise.targetDuration % 60;
				const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
				exerciseLine += `[${durationStr}]`;
			} else {
				exerciseLine += `[${param.value}]`;
			}

			if (param.unit) {
				exerciseLine += ` ${param.unit}`;
			}
		}

		lines.push(exerciseLine);

		// Add sets as indented sub-items
		for (const set of exercise.sets) {
			let setLine = '  - [ ]';

			for (const param of set.params) {
				setLine += ' ';
				setLine += `${param.key}: `;
				setLine += `[${param.value}]`;
				if (param.unit) {
					setLine += ` ${param.unit}`;
				}
			}

			lines.push(setLine);
		}
	}

	return lines.join('\n');
}
