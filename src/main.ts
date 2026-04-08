import { Plugin, MarkdownPostProcessorContext } from 'obsidian';
import { parseWorkout } from './parser';
import { serializeWorkout, updateParamValue, updateSetParamValue, updateExerciseState, updateSetState, addSet, addRest, setRecordedDuration, setSetRecordedDuration, lockAllFields, createSampleWorkout } from './serializer';
import { renderWorkout } from './renderer';
import { TimerManager } from './timer/manager';
import { FileUpdater } from './file/updater';
import { ParsedWorkout, WorkoutCallbacks, SectionInfo } from './types';
import { formatDurationHuman, parseDurationToSeconds } from './parser/exercise';

export default class WorkoutLogPlugin extends Plugin {
	private timerManager: TimerManager = new TimerManager();
	private fileUpdater: FileUpdater | null = null;

	async onload(): Promise<void> {
		this.fileUpdater = new FileUpdater(this.app);

		// Register the workout code block processor
		this.registerMarkdownCodeBlockProcessor('workout', (source, el, ctx) => {
			this.processWorkoutBlock(source, el, ctx);
		});
	}

	onunload(): void {
		this.timerManager.destroy();
	}

	private processWorkoutBlock(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): void {
		const parsed = parseWorkout(source);
		const sectionInfo = ctx.getSectionInfo(el) as SectionInfo | null;

		// Warn if sectionInfo is null - this can cause issues with multiple workouts
		if (!sectionInfo) {
			console.warn('Workout Log: sectionInfo is null for', ctx.sourcePath, '- file updates may not work correctly');
		}

		const workoutId = `${ctx.sourcePath}:${sectionInfo?.lineStart ?? 0}`;

		// Sync timer state with parsed state (handles undo/external changes)
		const isTimerRunning = this.timerManager.isTimerRunning(workoutId);
		if (isTimerRunning && parsed.metadata.state !== 'started') {
			// File was reverted to non-started state, stop the timer
			this.timerManager.stopWorkoutTimer(workoutId);
		} else if (isTimerRunning && parsed.metadata.state === 'started') {
			// Sync active exercise index with parsed state (handles undo of exercise actions)
			const parsedActiveIndex = parsed.exercises.findIndex(e => e.state === 'inProgress');
			const timerActiveIndex = this.timerManager.getActiveExerciseIndex(workoutId);
			if (parsedActiveIndex >= 0 && parsedActiveIndex !== timerActiveIndex) {
				// Active exercise changed externally (undo), update timer
				this.timerManager.setActiveExerciseIndex(workoutId, parsedActiveIndex);
			}
		}

		const callbacks = this.createCallbacks(ctx, sectionInfo, parsed, workoutId);

		renderWorkout({
			el,
			parsed,
			callbacks,
			workoutId,
			timerManager: this.timerManager
		});
	}

	private createCallbacks(
		ctx: MarkdownPostProcessorContext,
		sectionInfo: SectionInfo | null,
		parsed: ParsedWorkout,
		workoutId: string
	): WorkoutCallbacks {
		// Keep a reference to current parsed state
		let currentParsed = parsed;
		let hasPendingChanges = false;

		const updateFile = async (newParsed: ParsedWorkout): Promise<void> => {
			currentParsed = newParsed;
			hasPendingChanges = false;
			const newContent = serializeWorkout(newParsed);
			// Pass title for validation to prevent cross-block contamination
			const expectedTitle = currentParsed.metadata.title;
			await this.fileUpdater?.updateCodeBlock(ctx.sourcePath, sectionInfo, newContent, expectedTitle);
		};

		// Flush any pending param changes to file
		const flushChanges = async (): Promise<void> => {
			if (hasPendingChanges) {
				await updateFile(currentParsed);
			}
		};

		return {
			onStartWorkout: async (): Promise<void> => {
				hasPendingChanges = false; // Will be saved by updateFile below
				// Update state to started
				currentParsed.metadata.state = 'started';
				currentParsed.metadata.startDate = this.formatStartDate(new Date());

				// Activate first pending exercise
				const firstPending = currentParsed.exercises.findIndex(e => e.state === 'pending');
				if (firstPending >= 0) {
					const exercise = currentParsed.exercises[firstPending];
					if (exercise) {
						exercise.state = 'inProgress';
					}
				}

				await updateFile(currentParsed);

				// Start timers
				this.timerManager.startWorkoutTimer(workoutId, firstPending >= 0 ? firstPending : 0);
			},

			onFinishWorkout: async (): Promise<void> => {
				// Calculate duration
				const timerState = this.timerManager.getTimerState(workoutId);
				if (timerState) {
					currentParsed.metadata.duration = formatDurationHuman(timerState.workoutElapsed);
				}

				currentParsed.metadata.state = 'completed';

				// Lock all fields
				currentParsed = lockAllFields(currentParsed);

				await updateFile(currentParsed);

				// Stop timer
				this.timerManager.stopWorkoutTimer(workoutId);
			},

			onExerciseFinish: async (exerciseIndex: number): Promise<void> => {
				hasPendingChanges = false; // Will be saved by updateFile below
				const exercise = currentParsed.exercises[exerciseIndex];
				if (!exercise) return;

				const activeSetIndex = this.timerManager.getActiveSetIndex(workoutId);
				const timerState = this.timerManager.getTimerState(workoutId);

				// If in rest mode, exit rest and advance to next set
				if (timerState?.isRestActive) {
					const nextSetIndex = activeSetIndex + 1;
					if (nextSetIndex < exercise.sets.length) {
						currentParsed = updateSetState(currentParsed, exerciseIndex, nextSetIndex, 'inProgress');
						this.timerManager.exitRest(workoutId, exerciseIndex, nextSetIndex);
						await updateFile(currentParsed);
					}
					return;
				}

				// Record duration for current set
				if (timerState) {
					currentParsed = setSetRecordedDuration(
						currentParsed,
						exerciseIndex,
						activeSetIndex,
						formatDurationHuman(timerState.exerciseElapsed)
					);
				}

				// Mark current set as completed
				currentParsed = updateSetState(currentParsed, exerciseIndex, activeSetIndex, 'completed');

				// Check if there are more sets in this exercise
				if (activeSetIndex < exercise.sets.length - 1) {
					// Check if current set has a rest period
					const currentSet = exercise.sets[activeSetIndex];				if (!currentSet) return;
									const restParam = currentSet.params.find(p => p.key.toLowerCase() === 'rest');
					
					if (restParam) {
						// Start rest timer instead of immediately advancing
					const restDurationSeconds = parseDurationToSeconds(restParam.value);
					this.timerManager.startRest(workoutId, restDurationSeconds);
						await updateFile(currentParsed);
					} else {
						// No rest, advance immediately to next set
						const nextSetIndex = activeSetIndex + 1;
						currentParsed = updateSetState(currentParsed, exerciseIndex, nextSetIndex, 'inProgress');
						this.timerManager.advanceSet(workoutId, exerciseIndex, nextSetIndex);
						await updateFile(currentParsed);
					}
				} else {
					// No more sets, finish the exercise and move to next exercise
					currentParsed = updateExerciseState(currentParsed, exerciseIndex, 'completed');

					// Find next pending exercise
					const nextPending = currentParsed.exercises.findIndex(
						(e, i) => i > exerciseIndex && e.state === 'pending'
					);

					if (nextPending >= 0) {
						// Activate next exercise
						currentParsed = updateExerciseState(currentParsed, nextPending, 'inProgress');

						// Advance timer BEFORE file update so re-render sees reset timer
						this.timerManager.advanceExercise(workoutId, nextPending);

						await updateFile(currentParsed);
					} else {
						// No more exercises, complete workout
						currentParsed.metadata.state = 'completed';
						const finalState = this.timerManager.getTimerState(workoutId);
						if (finalState) {
							currentParsed.metadata.duration = formatDurationHuman(finalState.workoutElapsed);
						}
						currentParsed = lockAllFields(currentParsed);
						await updateFile(currentParsed);
						this.timerManager.stopWorkoutTimer(workoutId);
					}
				}
			},

			onExerciseAddSet: async (exerciseIndex: number): Promise<void> => {
				hasPendingChanges = false; // Will be saved by updateFile below
				const exercise = currentParsed.exercises[exerciseIndex];
				if (!exercise) return;

				const activeSetIndex = this.timerManager.getActiveSetIndex(workoutId);

				// Record duration for current set
				const timerState = this.timerManager.getTimerState(workoutId);
				if (timerState) {
					currentParsed = setSetRecordedDuration(
						currentParsed,
						exerciseIndex,
						activeSetIndex,
						formatDurationHuman(timerState.exerciseElapsed)
					);
				}

				// Mark current set as completed
				currentParsed = updateSetState(currentParsed, exerciseIndex, activeSetIndex, 'completed');

				// Add new set
				currentParsed = addSet(currentParsed, exerciseIndex);

				// The new set is at exercise.sets.length - 1, activate it
				const newSetIndex = currentParsed.exercises[exerciseIndex]?.sets.length || 0 - 1;
				currentParsed = updateSetState(currentParsed, exerciseIndex, newSetIndex, 'inProgress');

				// Advance timer to new set
				this.timerManager.advanceSet(workoutId, exerciseIndex, newSetIndex);

				await updateFile(currentParsed);
			},

			onExerciseAddRest: async (exerciseIndex: number): Promise<void> => {
				hasPendingChanges = false; // Will be saved by updateFile below
				const exercise = currentParsed.exercises[exerciseIndex];
				const restDuration = currentParsed.metadata.restDuration;
				if (!exercise || !restDuration) return;

				const activeSetIndex = this.timerManager.getActiveSetIndex(workoutId);

				// Record duration for current set
				const timerState = this.timerManager.getTimerState(workoutId);
				if (timerState) {
					currentParsed = setSetRecordedDuration(
						currentParsed,
						exerciseIndex,
						activeSetIndex,
						formatDurationHuman(timerState.exerciseElapsed)
					);
				}

				// Mark current set as completed
				currentParsed = updateSetState(currentParsed, exerciseIndex, activeSetIndex, 'completed');

				// Add rest exercise (inserts after current)
				currentParsed = addRest(currentParsed, exerciseIndex, restDuration);

				// The new rest is at exerciseIndex + 1, activate it with its first set
				currentParsed = updateExerciseState(currentParsed, exerciseIndex + 1, 'inProgress');

				// Advance timer to new exercise with set index 0
				this.timerManager.advanceSet(workoutId, exerciseIndex + 1, 0);

				await updateFile(currentParsed);
			},

			onExerciseSkip: async (exerciseIndex: number): Promise<void> => {
				hasPendingChanges = false; // Will be saved by updateFile below
				const exercise = currentParsed.exercises[exerciseIndex];
				if (!exercise) return;

				const activeSetIndex = this.timerManager.getActiveSetIndex(workoutId);

				// Mark current set as skipped
				currentParsed = updateSetState(currentParsed, exerciseIndex, activeSetIndex, 'skipped');

				// Check if there are more sets in this exercise
				if (activeSetIndex < exercise.sets.length - 1) {
					// Advance to next set
					const nextSetIndex = activeSetIndex + 1;
					currentParsed = updateSetState(currentParsed, exerciseIndex, nextSetIndex, 'inProgress');
					this.timerManager.advanceSet(workoutId, exerciseIndex, nextSetIndex);
					await updateFile(currentParsed);
				} else {
					// No more sets, finish the exercise and move to next exercise
					currentParsed = updateExerciseState(currentParsed, exerciseIndex, 'completed');

					// Find next pending exercise
					const nextPending = currentParsed.exercises.findIndex(
						(e, i) => i > exerciseIndex && e.state === 'pending'
					);

					if (nextPending >= 0) {
						currentParsed = updateExerciseState(currentParsed, nextPending, 'inProgress');

						// Advance timer BEFORE file update so re-render sees reset timer
						this.timerManager.advanceExercise(workoutId, nextPending);

						await updateFile(currentParsed);
					} else {
						// No more exercises, complete workout
						currentParsed.metadata.state = 'completed';
						const finalState = this.timerManager.getTimerState(workoutId);
						if (finalState) {
							currentParsed.metadata.duration = formatDurationHuman(finalState.workoutElapsed);
						}
						currentParsed = lockAllFields(currentParsed);

						await updateFile(currentParsed);
						this.timerManager.stopWorkoutTimer(workoutId);
					}
				}
			},

			onParamChange: (exerciseIndex: number, paramKey: string, newValue: string): void => {
				// Check if value actually changed
				const exercise = currentParsed.exercises[exerciseIndex];
				const param = exercise?.params.find(p => p.key === paramKey);
				if (param?.value === newValue) {
					return; // No change, skip update
				}
				currentParsed = updateParamValue(currentParsed, exerciseIndex, paramKey, newValue);
				hasPendingChanges = true;
				// Don't save to file yet - wait for flush
			},

			onSetParamChange: (exerciseIndex: number, setIndex: number, paramKey: string, newValue: string): void => {
				// Check if value actually changed
				const exercise = currentParsed.exercises[exerciseIndex];
				const set = exercise?.sets[setIndex];
				const param = set?.params.find(p => p.key === paramKey);
				if (param?.value === newValue) {
					return; // No change, skip update
				}
				currentParsed = updateSetParamValue(currentParsed, exerciseIndex, setIndex, paramKey, newValue);
				hasPendingChanges = true;
				// Don't save to file yet - wait for flush
			},

			onFlushChanges: flushChanges,

			onPauseExercise: (): void => {
				this.timerManager.pauseExercise(workoutId);
			},

			onResumeExercise: (): void => {
				this.timerManager.resumeExercise(workoutId);
			},

			onAddSample: async (): Promise<void> => {
				const sampleWorkout = createSampleWorkout();
				const newContent = serializeWorkout(sampleWorkout);
				await this.fileUpdater?.updateCodeBlock(
					ctx.sourcePath,
					sectionInfo,
					newContent,
					sampleWorkout.metadata.title
				);
			}
		};
	}

	private formatStartDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		return `${year}-${month}-${day} ${hours}:${minutes}`;
	}
}
