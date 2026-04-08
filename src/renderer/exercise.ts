import { Exercise, ExerciseSet, ExerciseParam, ExerciseState, TimerState, WorkoutCallbacks } from '../types';
import { formatDuration, parseDurationToSeconds, formatDurationHuman } from '../parser/exercise';

const STATE_ICONS: Record<ExerciseState, string> = {
	'pending': '○',
	'inProgress': '◐',
	'completed': '✓',
	'skipped': '—'
};

// Generate a consistent color hue from exercise name (djb2 hash with better distribution)
function nameToHue(name: string): number {
	let hash = 5381;
	for (let i = 0; i < name.length; i++) {
		hash = ((hash << 5) + hash) ^ name.charCodeAt(i);
	}
	// Use golden ratio to spread hues more evenly
	const golden = 0.618033988749895;
	const normalized = (Math.abs(hash) % 1000) / 1000;
	return Math.floor(((normalized * golden) % 1) * 360);
}

export interface ExerciseElements {
	container: HTMLElement;
	timerEl: HTMLElement | null;
	setTimerEl: HTMLElement | null;  // Timer element for active set
	inputs: Map<string, HTMLInputElement>;
	setInputs: Map<number, Map<string, HTMLInputElement>>;  // Indexed by set index
}

// Check if set has params to display (excludes Duration which is shown separately)
function hasDisplayableSetParams(set: ExerciseSet): boolean {
	return set.params.some(p => p.key.toLowerCase() !== 'duration');
}

// Get params to display inline (excludes Duration and recorded values)
function getDisplayableSetParams(set: ExerciseSet): ExerciseParam[] {
	return set.params.filter(p => p.key.toLowerCase() !== 'duration');
}

// Get recorded duration from a set (if any)
function getSetRecordedDuration(set: ExerciseSet): string | null {
	const durationParam = set.params.find(p => p.key.toLowerCase() === 'duration' && !p.editable);
	return durationParam ? durationParam.value : null;
}

// Get rest duration from a set (if any)
function getSetRestDuration(set: ExerciseSet): string | null {
	const restParam = set.params.find(p => p.key.toLowerCase() === 'rest');
	return restParam ? restParam.value : null;
}

// Compute totals from all sets
function computeExerciseTotals(exercise: Exercise, isCompleted: boolean): { 
	reps: number | null; 
	weight: number | null; 
	duration: number;
	totalRecordedTime: number;
	totalRest: number;
} {
	let totalReps = 0;
	let totalWeight = 0;
	let totalRecordedTime = 0;
	let totalRest = 0;
	let repsFound = false;
	let weightFound = false;
	let targetDuration = exercise.targetDuration || 0;

	for (const set of exercise.sets) {
		for (const param of set.params) {
			if (param.key.toLowerCase() === 'reps') {
				const reps = parseInt(param.value, 10);
				if (!isNaN(reps)) {
					totalReps += reps;
					repsFound = true;
				}
			} else if (param.key.toLowerCase() === 'weight' || param.key.toLowerCase() === 'load') {
				const weight = parseFloat(param.value);
				if (!isNaN(weight)) {
					totalWeight = weight; // Use last weight value (assume same for all sets)
					weightFound = true;
				}
			} else if (param.key.toLowerCase() === 'rest') {
				// Sum rest durations from all sets (only if editable, meaning user-set)
				if (param.editable) {
					const restSeconds = parseDurationToSeconds(param.value);
					totalRest += restSeconds;
				}
			}
		}

		// If exercise is completed, sum up recorded durations from each set
		if (isCompleted) {
			for (const param of set.params) {
				if (param.key.toLowerCase() === 'duration' && !param.editable) {
					// This is a recorded duration (not editable means it's recorded)
					const seconds = parseDurationToSeconds(param.value);
					totalRecordedTime += seconds;
				}
			}
		}
	}

	return {
		reps: repsFound ? totalReps : null,
		weight: weightFound ? totalWeight : null,
		duration: targetDuration,
		totalRecordedTime,
		totalRest
	};
}

export function renderExercise(
	container: HTMLElement,
	exercise: Exercise,
	index: number,
	isActive: boolean,
	activeSetIndex: number,
	timerState: TimerState | null,
	callbacks: WorkoutCallbacks,
	workoutState: 'planned' | 'started' | 'completed',
	restDuration?: number,
	totalExercises?: number
): ExerciseElements {
	const exerciseEl = container.createDiv({
		cls: `workout-exercise state-${exercise.state}${isActive ? ' active' : ''}`
	});

	// Set color based on exercise name
	const hue = nameToHue(exercise.name);
	exerciseEl.style.setProperty('--exercise-color', `hsl(${hue}, 65%, 55%)`);

	const inputs = new Map<string, HTMLInputElement>();
	const setInputs = new Map<number, Map<string, HTMLInputElement>>();
	let setTimerEl: HTMLElement | null = null;  // Track active set timer for updates

	// Single row: icon | name | params | timer
	const mainRow = exerciseEl.createDiv({ cls: 'workout-exercise-main' });

	// State icon
	const iconEl = mainRow.createSpan({ cls: 'workout-exercise-icon' });
	iconEl.textContent = STATE_ICONS[exercise.state];

	// Exercise name
	const nameEl = mainRow.createSpan({ cls: 'workout-exercise-name' });
	nameEl.textContent = exercise.name;

	// Display totals from all sets (reps, weight, etc.)
	const isCompleted = exercise.state === 'completed';
	const totals = computeExerciseTotals(exercise, isCompleted);
	
	if (totals.reps !== null || totals.weight !== null || (isCompleted && totals.totalRecordedTime > 0) || totals.totalRest > 0) {
		const totalsEl = mainRow.createSpan({ cls: 'workout-exercise-totals' });

		// Show total reps
		if (totals.reps !== null) {
			const repsEl = totalsEl.createSpan({ cls: 'workout-total' });
			repsEl.createSpan({ cls: 'workout-param-prefix', text: '×' });
			repsEl.createSpan({ cls: 'workout-param-value', text: String(totals.reps) });
		}

		// Show weight
		if (totals.weight !== null) {
			const weightEl = totalsEl.createSpan({ cls: 'workout-total' });
			weightEl.createSpan({ cls: 'workout-param-value', text: String(totals.weight) });
			weightEl.createSpan({ cls: 'workout-param-unit', text: ' lbs' });
		}

		// Show total recorded time when completed
		if (isCompleted && totals.totalRecordedTime > 0) {
			const timeEl = totalsEl.createSpan({ cls: 'workout-total' });
			timeEl.createSpan({ cls: 'workout-param-value', text: formatDurationHuman(totals.totalRecordedTime) });
		}

		// Show total rest time
		if (totals.totalRest > 0) {
			const restEl = totalsEl.createSpan({ cls: 'workout-total workout-rest' });
			restEl.createSpan({ cls: 'workout-param-prefix', text: '⏸' });
			restEl.createSpan({ cls: 'workout-param-value', text: formatDurationHuman(totals.totalRest) });
		}
	}

	// Params inline (between name and timer) - chip/pill style
	if (exercise.params.length > 0) {
		const paramsEl = mainRow.createSpan({ cls: 'workout-exercise-params' });

		for (const param of exercise.params) {
			// Skip Duration param (shown in timer)
			if (param.key.toLowerCase() === 'duration') continue;

			const paramEl = paramsEl.createSpan({ cls: 'workout-param' });

			// × prefix for params without units (plain numbers)
			if (!param.unit) {
				paramEl.createSpan({ cls: 'workout-param-prefix', text: '×' });
			}

			if (param.editable && workoutState !== 'completed') {
				const input = paramEl.createEl('input', {
					cls: 'workout-param-input',
					type: 'text',
					value: param.value
				});
				// Track changes immediately (updates in-memory state)
				input.addEventListener('input', () => {
					callbacks.onParamChange(index, param.key, input.value);
				});
				input.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						input.blur();
					}
				});
				inputs.set(param.key, input);
			} else {
				paramEl.createSpan({ cls: 'workout-param-value', text: param.value });
			}

			// Unit after value
			if (param.unit) {
				paramEl.createSpan({ cls: 'workout-param-unit', text: ` ${param.unit}` });
			}
		}
	}

	// Timer display (right side) - only if no sets
	// (timer shows on active set when sets exist)
	let timerEl: HTMLElement | null = null;
	
	if (exercise.sets.length === 0) {
		timerEl = mainRow.createSpan({ cls: 'workout-exercise-timer' });

		if (exercise.state === 'completed' && exercise.recordedDuration) {
			timerEl.textContent = exercise.recordedDuration;
			timerEl.createSpan({ cls: 'timer-indicator recorded', text: ' ✓' });
		} else if (isActive && timerState) {
			updateExerciseTimer(timerEl, timerState, exercise.targetDuration);
		} else if (exercise.targetDuration) {
			timerEl.textContent = formatDuration(exercise.targetDuration);
			timerEl.createSpan({ cls: 'timer-indicator count-down', text: ' ▼' });
		} else if (exercise.state === 'pending') {
			timerEl.textContent = '--';
		}
	}

	// Render sets as indented rows
	if (exercise.sets.length > 0) {
		const setsContainer = exerciseEl.createDiv({ cls: 'workout-sets' });
		for (let setIndex = 0; setIndex < exercise.sets.length; setIndex++) {
			const set = exercise.sets[setIndex];
			if (!set) continue;

			const isSetActive = isActive && setIndex === activeSetIndex;
			if (isSetActive) {
				// Store timer element for active set so we can update it
				setTimerEl = renderSetWithTimerElement(
					setsContainer,
					set,
					setIndex,
					index,
					isSetActive,
					isSetActive ? timerState : null,
					callbacks,
					workoutState,
					setInputs
				);
			} else {
				renderSet(
					setsContainer,
					set,
					setIndex,
					index,
					isSetActive,
					isSetActive ? timerState : null,
					callbacks,
					workoutState,
					setInputs
				);
			}
		}
	}

	// Controls row (only for active set during workout)
	if (isActive && workoutState === 'started') {
		renderSetControls(exerciseEl, index, activeSetIndex, exercise.sets.length, callbacks, restDuration, timerState, totalExercises);
	}

	return { container: exerciseEl, timerEl, setTimerEl, inputs, setInputs };
}

function renderSet(
	container: HTMLElement,
	set: ExerciseSet,
	setIndex: number,
	exerciseIndex: number,
	isActive: boolean,
	timerState: TimerState | null,
	callbacks: WorkoutCallbacks,
	workoutState: 'planned' | 'started' | 'completed',
	setInputs: Map<number, Map<string, HTMLInputElement>>
): void {
	renderSetWithTimerElement(container, set, setIndex, exerciseIndex, isActive, timerState, callbacks, workoutState, setInputs);
}

function renderSetWithTimerElement(
	container: HTMLElement,
	set: ExerciseSet,
	setIndex: number,
	exerciseIndex: number,
	isActive: boolean,
	timerState: TimerState | null,
	callbacks: WorkoutCallbacks,
	workoutState: 'planned' | 'started' | 'completed',
	setInputs: Map<number, Map<string, HTMLInputElement>>
): HTMLElement | null {
	const setEl = container.createDiv({
		cls: `workout-set state-${set.state}${isActive ? ' active' : ''}`
	});

	const setRow = setEl.createDiv({ cls: 'workout-set-main' });

	// State icon
	const iconEl = setRow.createSpan({ cls: 'workout-set-icon' });
	iconEl.textContent = STATE_ICONS[set.state];

	// Set label
	const labelEl = setRow.createSpan({ cls: 'workout-set-label' });
	labelEl.textContent = `Set ${setIndex + 1}`;

	// Set params as inline chips
	if (hasDisplayableSetParams(set)) {
		const paramsEl = setRow.createSpan({ cls: 'workout-set-params' });

		const setParamInputs = new Map<string, HTMLInputElement>();
		const displayableParams = getDisplayableSetParams(set);

		for (const param of displayableParams) {
			const paramEl = paramsEl.createSpan({ cls: 'workout-param' });

			// × prefix for params without units
			if (!param.unit) {
				paramEl.createSpan({ cls: 'workout-param-prefix', text: '×' });
			}

			if (param.editable && workoutState !== 'completed') {
				const input = paramEl.createEl('input', {
					cls: 'workout-param-input',
					type: 'text',
					value: param.value
				});
				input.addEventListener('input', () => {
					callbacks.onSetParamChange(exerciseIndex, setIndex, param.key, input.value);
				});
				input.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						input.blur();
					}
				});
				setParamInputs.set(param.key, input);
			} else {
				paramEl.createSpan({ cls: 'workout-param-value', text: param.value });
			}

			// Unit after value
			if (param.unit) {
				paramEl.createSpan({ cls: 'workout-param-unit', text: ` ${param.unit}` });
			}
		}

		setInputs.set(setIndex, setParamInputs);
	}

	// Show recorded duration for completed sets (similar to exercise totals)
	const recordedDuration = getSetRecordedDuration(set);
	if (recordedDuration && workoutState === 'completed') {
		const setDurationEl = setRow.createSpan({ cls: 'workout-set-duration' });
		setDurationEl.createSpan({ cls: 'workout-param-value', text: recordedDuration });
	}

	// Show Rest duration if set has one
	const restDurationStr = getSetRestDuration(set);
	if (restDurationStr) {
		const restEl = setRow.createSpan({ cls: 'workout-set-rest-info' });
		restEl.createSpan({ cls: 'workout-param-prefix', text: '⏸' });
		restEl.createSpan({ cls: 'workout-param-value', text: restDurationStr });
	}

	// Timer display for active set (right side)
	let timerEl: HTMLElement | null = null;
	if (isActive && timerState) {
		timerEl = setRow.createSpan({ cls: 'workout-set-timer' });
		
		// If in rest mode, show rest timer
		if (timerState.isRestActive && timerState.restRemaining !== undefined) {
			const restDuration = restDurationStr ? parseDurationToSeconds(restDurationStr) : 0;
			const remaining = timerState.restRemaining;
			
			// Calculate rest progress and apply color phase class
			if (restDuration > 0) {
				const restProgress = remaining / restDuration;
				
				if (restProgress > 0.66) {
					// Green phase: 66-100% remaining
					setEl.removeClass('rest-phase-yellow');
					setEl.removeClass('rest-phase-red');
					setEl.addClass('rest-phase-green');
				} else if (restProgress > 0.33) {
					// Yellow phase: 33-66% remaining
					setEl.removeClass('rest-phase-green');
					setEl.removeClass('rest-phase-red');
					setEl.addClass('rest-phase-yellow');
				} else {
					// Red phase: 0-33% remaining
					setEl.removeClass('rest-phase-green');
					setEl.removeClass('rest-phase-yellow');
					setEl.addClass('rest-phase-red');
				}
			}
			
			if (remaining > 0) {
				timerEl.textContent = formatDuration(remaining);
				timerEl.createSpan({ cls: 'timer-indicator rest', text: ' ⏸' });
			} else {
				timerEl.textContent = formatDuration(Math.abs(remaining));
				timerEl.addClass('rest-overtime');
				timerEl.createSpan({ cls: 'timer-indicator', text: ' ⏸' });
			}
		} else {
			// Show exercise timer
			updateExerciseTimer(timerEl, timerState, undefined);
		}
	}
	
	return timerEl;
}

function renderSetControls(
	exerciseEl: HTMLElement,
	exerciseIndex: number,
	setIndex: number,
	totalSets: number,
	callbacks: WorkoutCallbacks,
	restDuration?: number,
	timerState?: TimerState | null,
	totalExercises?: number
): void {
	const controlsEl = exerciseEl.createDiv({ cls: 'workout-exercise-controls' });

	// Pause/Resume button
	const pauseBtn = controlsEl.createEl('button', { cls: 'workout-btn', text: 'Pause' });
	pauseBtn.addEventListener('click', () => {
		if (pauseBtn.textContent === 'Pause') {
			callbacks.onPauseExercise();
			pauseBtn.textContent = 'Resume';
		} else {
			callbacks.onResumeExercise();
			pauseBtn.textContent = 'Pause';
		}
	});

	// Skip button
	const skipBtn = controlsEl.createEl('button', { cls: 'workout-btn', text: 'Skip' });
	skipBtn.addEventListener('click', () => {
		callbacks.onExerciseSkip(exerciseIndex);
	});

	// Finish group container
	const finishGroup = controlsEl.createDiv({ cls: 'workout-btn-group' });

	// Add Set button (for additional sets)
	const addSetBtn = finishGroup.createEl('button', { cls: 'workout-btn', text: '+ Set' });
	addSetBtn.addEventListener('click', () => {
		callbacks.onExerciseAddSet(exerciseIndex);
	});

	// Add Rest button (only if restDuration is defined)
	if (restDuration !== undefined) {
		const addRestBtn = finishGroup.createEl('button', { cls: 'workout-btn', text: '+ Rest' });
		addRestBtn.addEventListener('click', () => {
			callbacks.onExerciseAddRest(exerciseIndex);
		});
	}

	// Determine button text based on rest state
	let nextBtnText: string;
	if (timerState?.isRestActive) {
		// During rest, show "Skip Rest" or "Start Next"
		nextBtnText = 'Start Next';
	} else {
		const isLastSet = setIndex === totalSets - 1;
		const isLastExercise = typeof totalExercises === 'number' ? (exerciseIndex === totalExercises - 1) : false;
		if (isLastSet && !isLastExercise) {
			nextBtnText = 'Next';
		} else if (isLastSet && isLastExercise) {
			nextBtnText = 'Done';
		} else {
			nextBtnText = 'Next Set';
		}
	}
	
	const nextBtn = finishGroup.createEl('button', { cls: 'workout-btn', text: nextBtnText });
	nextBtn.addEventListener('click', () => {
		if (timerState?.isRestActive) {
			// Currently in rest period, end it and advance to next set
			callbacks.onRestEnd(exerciseIndex);
		} else {
			// Finishing a set, may start rest or advance
			callbacks.onSetFinish(exerciseIndex, setIndex);
		}
	});
}

export function updateExerciseTimer(
	timerEl: HTMLElement,
	timerState: TimerState,
	targetDuration?: number
): void {
	timerEl.empty();

	if (targetDuration !== undefined) {
		// Countdown mode
		const remaining = targetDuration - timerState.exerciseElapsed;
		if (remaining > 0) {
			timerEl.textContent = formatDuration(remaining);
			timerEl.createSpan({ cls: 'timer-indicator count-down', text: ' ▼' });
		} else {
			// Overtime
			timerEl.textContent = formatDuration(Math.abs(remaining));
			timerEl.addClass('overtime');
			timerEl.createSpan({ cls: 'timer-indicator overtime', text: ' ⚠' });
		}
	} else {
		// Count up mode
		timerEl.textContent = formatDuration(timerState.exerciseElapsed);
		timerEl.createSpan({ cls: 'timer-indicator count-up', text: ' ▲' });
	}
}
