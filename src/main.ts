import { Plugin, MarkdownPostProcessorContext } from 'obsidian';
import { parseWorkout } from './parser';
import { serializeWorkout, updateParamValue, updateSetParamValue, updateExerciseState, updateSetState, addSet, addRest, setRecordedDuration, setSetRecordedDuration, setSetRecordedRest, lockAllFields, createSampleWorkout } from './serializer';
import { renderWorkout } from './renderer';
import { TimerManager } from './timer/manager';
import { FileUpdater } from './file/updater';
import { ParsedWorkout, WorkoutCallbacks, SectionInfo, Exercise } from './types';
import { formatDurationHuman, parseDurationToSeconds } from './parser/exercise';

export default class WorkoutLogPlugin extends Plugin {
	private timerManager: TimerManager = new TimerManager();
	private fileUpdater: FileUpdater | null = null;

	/**
	 * Called when the plugin loads. Initializes the file updater and registers the workout code block processor.
	 * After this, Obsidian will call our processor whenever it encounters a ```workout code block.
	 */
	async onload(): Promise<void> {
		this.fileUpdater = new FileUpdater(this.app);

		// Register the markdown code block processor for 'workout' blocks
		// Tells Obsidian: "When you find a code block of type 'workout', call processWorkoutBlock"
		this.registerMarkdownCodeBlockProcessor('workout', (source, el, ctx) => {
			this.processWorkoutBlock(source, el, ctx);
		});
	}

	/**
	 * Called when the plugin unloads. Cleans up resources, especially the timer manager.
	 * Ensures all active timers are stopped and cleaned up gracefully.
	 */
	onunload(): void {
		this.timerManager.destroy();
	}

	/**
	 * Processes a single workout code block when Obsidian renders it.
	 * This is the main entry point for each workout workout visible on screen.
	 * 
	 * Key responsibilities:
	 * 1. Parse the markdown source into structured workout data
	 * 2. Generate unique ID for this workout (file path + line number)
	 * 3. Sync timer state with file state (handles undo/external edits)
	 * 4. Create callbacks for user interactions
	 * 5. Render the UI and connect timers
	 * 
	 * @param source - Raw markdown text from the code block
	 * @param el - DOM element where UI should be rendered
	 * @param ctx - Obsidian context (has file path, section info, etc)
	 */
	private processWorkoutBlock(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): void {
		// Parse markdown source into ParsedWorkout structure
		const parsed = parseWorkout(source);
		const sectionInfo = ctx.getSectionInfo(el) as SectionInfo | null;

		// Warn if sectionInfo is null - this can cause issues with multiple workouts
		if (!sectionInfo) {
			console.warn('Workout Log: sectionInfo is null for', ctx.sourcePath, '- file updates may not work correctly');
		}

		// Generate unique workout ID: prevents timer confusion when multiple workouts exist in same file
		// Format: "path/to/file.md:123" where 123 is the line number of workout block start
		const workoutId = `${ctx.sourcePath}:${sectionInfo?.lineStart ?? 0}`;

		// Sync timer state with file state (critical for handling undo/external changes)
		// If user hit undo, file may have changed but timer is still running
		const isTimerRunning = this.timerManager.isTimerRunning(workoutId);
		if (isTimerRunning && parsed.metadata.state !== 'started') {
			// File was reverted to non-started state (user hit undo), stop the timer
			this.timerManager.stopWorkoutTimer(workoutId);
		} else if (isTimerRunning && parsed.metadata.state === 'started') {
			// Timer is running and file is still started. Check if active exercise changed due to undo
			const parsedActiveIndex = parsed.exercises.findIndex(e => e.state === 'inProgress');
			const timerActiveIndex = this.timerManager.getActiveExerciseIndex(workoutId);
			if (parsedActiveIndex >= 0 && parsedActiveIndex !== timerActiveIndex) {
				// Active exercise changed externally (user hit undo on exercise action), resync timer
				this.timerManager.setActiveExerciseIndex(workoutId, parsedActiveIndex);
			}
		}

		// Create the callback functions that will handle user interactions
		const callbacks = this.createCallbacks(ctx, sectionInfo, parsed, workoutId);

		// Render the UI and wire up the timers and callbacks
		renderWorkout({
			el,
			parsed,
			callbacks,
			workoutId,
			timerManager: this.timerManager
		});
	}

	// ==================== HELPER METHODS ====================
	/**
	 * Finds the next pending exercise after the given index.
	 * Used to determine which exercise to activate when current one finishes.
	 * @param afterIndex - Start searching after this exercise index
	 * @param exercises - Array of exercises to search
	 * @returns Index of next pending exercise, or -1 if none found
	 */
	private findNextPendingExercise(afterIndex: number, exercises: Exercise[]): number {
		return exercises.findIndex((e, i) => i > afterIndex && e.state === 'pending');
	}

	/**
	 * Serializes the current parsed workout state and saves it back to the file.
	 * This is the main persistence mechanism - all state changes flow through here.
	 * Also handles optional saving to Obsidian properties (front matter) if enabled.
	 * @param ctx - Markdown processor context with file info
	 * @param sectionInfo - Section location in file (for updating the correct code block)
	 * @param parsed - Current workout state to persist
	 */
	private async updateFileWithParsed(
		ctx: MarkdownPostProcessorContext,
		sectionInfo: SectionInfo | null,
		parsed: ParsedWorkout
	): Promise<void> {
		const newContent = serializeWorkout(parsed);
		const expectedTitle = parsed.metadata.title;
		// Update the code block with new content, title validation prevents cross-contamination
		await this.fileUpdater?.updateCodeBlock(ctx.sourcePath, sectionInfo, newContent, expectedTitle);
		
		// Optionally save metadata to Obsidian file properties (front matter)
		if (parsed.metadata.saveToProperties) {
			await this.fileUpdater?.saveToProperties(ctx.sourcePath, parsed);
		}
	}

	// ==================== CALLBACK HANDLERS ====================
	// These methods handle major workout flow events (start, finish, exercise transitions).
	// Each one updates the parsed state and persists changes to the file.

	/**
	 * Handles workout start: sets metadata, activates first exercise, starts timers.
	 * Flow: Set state → Find first exercise → Activate it → Save → Start timers
	 */
	private async handleStartWorkout(
		currentParsed: ParsedWorkout,
		ctx: MarkdownPostProcessorContext,
		sectionInfo: SectionInfo | null,
		workoutId: string
	): Promise<void> {
		// Mark workout as started and record start time
		currentParsed.metadata.state = 'started';
		currentParsed.metadata.startDate = this.formatStartDate(new Date());

		// Find and activate the first pending exercise
		const firstPending = currentParsed.exercises.findIndex(e => e.state === 'pending');
		if (firstPending >= 0) {
			const exercise = currentParsed.exercises[firstPending];
			if (exercise) {
				exercise.state = 'inProgress';
			}
		}

		// Persist to file (state change must happen before timer starts)
		await this.updateFileWithParsed(ctx, sectionInfo, currentParsed);

		// Start the workout timer at the first exercise
		this.timerManager.startWorkoutTimer(workoutId, firstPending >= 0 ? firstPending : 0);
	}

	/**
	 * Handles workout completion: calculates total time, locks fields, saves state.
	 * Flow: Get elapsed time → Mark completed → Lock all params → Save → Stop timers
	 */
	private async handleFinishWorkout(
		currentParsed: ParsedWorkout,
		ctx: MarkdownPostProcessorContext,
		sectionInfo: SectionInfo | null,
		workoutId: string
	): Promise<void> {
		// Fetch total elapsed time from timer
		const timerState = this.timerManager.getTimerState(workoutId);
		if (timerState) {
			currentParsed.metadata.duration = formatDurationHuman(timerState.workoutElapsed);
		}

		// Mark workout as completed
		currentParsed.metadata.state = 'completed';

		// Lock all fields to prevent further edits once workout is done
		currentParsed = lockAllFields(currentParsed);

		// Persist final state to file
		await this.updateFileWithParsed(ctx, sectionInfo, currentParsed);

		// Stop the workout timer in the timer manager
		this.timerManager.stopWorkoutTimer(workoutId);
	}

	/**
	 * Handles set completion: records duration, handles rest periods, advances to next set or exercise.
	 * This is the most complex flow with multiple branching scenarios:
	 *   - If more sets exist in exercise: Check for rest period, start rest or advance to next set
	 *   - If last set in exercise: Mark exercise done, find next exercise or complete workout
	 * 
	 * @returns Updated ParsedWorkout for callback closure to capture
	 */
	private async handleSetFinish(
		exerciseIndex: number,
		setIndex: number,
		currentParsed: ParsedWorkout,
		ctx: MarkdownPostProcessorContext,
		sectionInfo: SectionInfo | null,
		workoutId: string,
		handleRestStart: (exerciseIndex: number, restDuration: number) => Promise<void>
	): Promise<ParsedWorkout> {
		const exercise = currentParsed.exercises[exerciseIndex];
		if (!exercise) return currentParsed;

		const timerState = this.timerManager.getTimerState(workoutId);

		// Step 1: Record how long this set actually took (from timer)
		if (timerState) {
			currentParsed = setSetRecordedDuration(
				currentParsed,
				exerciseIndex,
				setIndex,
				formatDurationHuman(timerState.exerciseElapsed)
			);
		}

		// Step 2: Mark current set as completed
		currentParsed = updateSetState(currentParsed, exerciseIndex, setIndex, 'completed');

		// Step 3: Branch based on whether there are more sets in this exercise
		if (setIndex < exercise.sets.length - 1) {
			// More sets exist - check if current set has a rest period attached
			const currentSet = exercise.sets[setIndex];
			if (!currentSet) return currentParsed;
			const restParam = currentSet.params.find(p => p.key.toLowerCase() === 'rest');
			
			if (restParam) {
				// Has rest period - save state first, then start rest timer
				await this.updateFileWithParsed(ctx, sectionInfo, currentParsed);
				const restDurationSeconds = parseDurationToSeconds(restParam.value);
				await handleRestStart(exerciseIndex, restDurationSeconds);
			} else {
				// No rest - advance immediately to next set
				const nextSetIndex = setIndex + 1;
				currentParsed = updateSetState(currentParsed, exerciseIndex, nextSetIndex, 'inProgress');
				this.timerManager.advanceSet(workoutId, exerciseIndex, nextSetIndex);
				await this.updateFileWithParsed(ctx, sectionInfo, currentParsed);
			}
		} else {
			// Last set in exercise - mark exercise as completed and look for next
			currentParsed = updateExerciseState(currentParsed, exerciseIndex, 'completed');

			const nextPending = this.findNextPendingExercise(exerciseIndex, currentParsed.exercises);

			if (nextPending >= 0) {
				// Found next exercise - activate it
				currentParsed = updateExerciseState(currentParsed, nextPending, 'inProgress');
				this.timerManager.advanceExercise(workoutId, nextPending);
				await this.updateFileWithParsed(ctx, sectionInfo, currentParsed);
			} else {
				// No more exercises - complete the entire workout
				await this.completeWorkout(currentParsed, ctx, sectionInfo, workoutId);
			}
		}

		return currentParsed;
	}

	/**
	 * Handles rest period completion: advances to next set or exercise.
	 * Called when user finishes rest between sets. Similar branching to handleSetFinish.
	 */
	private async handleRestEnd(
		exerciseIndex: number,
		currentParsed: ParsedWorkout,
		ctx: MarkdownPostProcessorContext,
		sectionInfo: SectionInfo | null,
		workoutId: string
	): Promise<ParsedWorkout> {
		const exercise = currentParsed.exercises[exerciseIndex];
		if (!exercise) return currentParsed;

		const activeSetIndex = this.timerManager.getActiveSetIndex(workoutId);

		// Record actual rest elapsed time before advancing
		const timerState = this.timerManager.getTimerState(workoutId);
		if (timerState && timerState.restElapsed !== undefined) {
			currentParsed = setSetRecordedRest(
				currentParsed,
				exerciseIndex,
				activeSetIndex,
				formatDurationHuman(timerState.restElapsed)
			);
		}

		// Rest finished, advance to next set
		const nextSetIndex = activeSetIndex + 1;
		if (nextSetIndex < exercise.sets.length) {
			// More sets exist - activate next one
			currentParsed = updateSetState(currentParsed, exerciseIndex, nextSetIndex, 'inProgress');
			this.timerManager.exitRest(workoutId, exerciseIndex, nextSetIndex);
			await this.updateFileWithParsed(ctx, sectionInfo, currentParsed);
		} else {
			// Last set done - move to next exercise
			currentParsed = updateExerciseState(currentParsed, exerciseIndex, 'completed');

			const nextPending = this.findNextPendingExercise(exerciseIndex, currentParsed.exercises);

			if (nextPending >= 0) {
				// Found next exercise
				currentParsed = updateExerciseState(currentParsed, nextPending, 'inProgress');
				this.timerManager.advanceExercise(workoutId, nextPending);
				await this.updateFileWithParsed(ctx, sectionInfo, currentParsed);
			} else {
				// No more exercises - complete entire workout
				await this.completeWorkout(currentParsed, ctx, sectionInfo, workoutId);
			}
		}

		return currentParsed;
	}

	/**
	 * Shared helper for marking workout as complete.
	 * Used when all exercises are done (called from multiple paths).
	 */
	private async completeWorkout(
		currentParsed: ParsedWorkout,
		ctx: MarkdownPostProcessorContext,
		sectionInfo: SectionInfo | null,
		workoutId: string
	): Promise<void> {
		// Mark as completed and record final duration
		currentParsed.metadata.state = 'completed';
		const finalState = this.timerManager.getTimerState(workoutId);
		if (finalState) {
			currentParsed.metadata.duration = formatDurationHuman(finalState.workoutElapsed);
		}
		// Lock all fields to prevent editing after completion
		currentParsed = lockAllFields(currentParsed);
		// Persist and stop timers
		await this.updateFileWithParsed(ctx, sectionInfo, currentParsed);
		this.timerManager.stopWorkoutTimer(workoutId);
	}

	/**
	 * Handles user skipping current set: marks as skipped, advances to next set or exercise.
	 */
	private async handleExerciseSkip(
		exerciseIndex: number,
		currentParsed: ParsedWorkout,
		ctx: MarkdownPostProcessorContext,
		sectionInfo: SectionInfo | null,
		workoutId: string
	): Promise<ParsedWorkout> {
		const exercise = currentParsed.exercises[exerciseIndex];
		if (!exercise) return currentParsed;

		const activeSetIndex = this.timerManager.getActiveSetIndex(workoutId);

		// Mark current set as skipped (user wants to skip, not complete)
		currentParsed = updateSetState(currentParsed, exerciseIndex, activeSetIndex, 'skipped');

		// Check if there are more sets in this exercise
		if (activeSetIndex < exercise.sets.length - 1) {
			// More sets exist - advance to next
			const nextSetIndex = activeSetIndex + 1;
			currentParsed = updateSetState(currentParsed, exerciseIndex, nextSetIndex, 'inProgress');
			this.timerManager.advanceSet(workoutId, exerciseIndex, nextSetIndex);
			await this.updateFileWithParsed(ctx, sectionInfo, currentParsed);
		} else {
			// Last set skipped - move to next exercise
			currentParsed = updateExerciseState(currentParsed, exerciseIndex, 'completed');

			const nextPending = this.findNextPendingExercise(exerciseIndex, currentParsed.exercises);

			if (nextPending >= 0) {
				currentParsed = updateExerciseState(currentParsed, nextPending, 'inProgress');

				// Advance timer BEFORE file update so re-render sees reset timer
				this.timerManager.advanceExercise(workoutId, nextPending);

				await this.updateFileWithParsed(ctx, sectionInfo, currentParsed);
			} else {
				// No more exercises, complete workout
				await this.completeWorkout(currentParsed, ctx, sectionInfo, workoutId);
			}
		}

		return currentParsed;
	}

	// ==================== CALLBACK CREATION ====================
	/**
	 * Creates the callback functions that are passed to the renderer.
	 * These callbacks handle all user interactions (buttons, input changes, etc).
	 * 
	 * The callbacks use a closure pattern to stay aware of:
	 * - currentParsed: Current state (updated as user interacts)
	 * - hasPendingChanges: Flag for debouncing param changes
	 * 
	 * Key patterns:
	 * - Workflow handlers (start, finish) call methods above
	 * - Param changes are batched and only flushed when leaving the field
	 * - All state changes flow through updateFile() to ensure persistence
	 */
	private createCallbacks(
		ctx: MarkdownPostProcessorContext,
		sectionInfo: SectionInfo | null,
		parsed: ParsedWorkout,
		workoutId: string
	): WorkoutCallbacks {
		let currentParsed = parsed;
		let hasPendingChanges = false;

		const updateFile = async (newParsed: ParsedWorkout): Promise<void> => {
			currentParsed = newParsed;
			hasPendingChanges = false;
			await this.updateFileWithParsed(ctx, sectionInfo, newParsed);
		};

		const flushChanges = async (): Promise<void> => {
			if (hasPendingChanges) {
				await updateFile(currentParsed);
			}
		};

		return {
			onStartWorkout: async (): Promise<void> => {
				await this.handleStartWorkout(currentParsed, ctx, sectionInfo, workoutId);
			},

			onFinishWorkout: async (): Promise<void> => {
				await this.handleFinishWorkout(currentParsed, ctx, sectionInfo, workoutId);
			},

			onExerciseFinish: async (exerciseIndex: number): Promise<void> => {
				const activeSetIndex = this.timerManager.getActiveSetIndex(workoutId);
				const timerState = this.timerManager.getTimerState(workoutId);
				
				if (timerState?.isRestActive) {
					currentParsed = await this.handleRestEnd(exerciseIndex, currentParsed, ctx, sectionInfo, workoutId);
				} else {
					currentParsed = await this.handleSetFinish(
						exerciseIndex,
						activeSetIndex,
						currentParsed,
						ctx,
						sectionInfo,
						workoutId,
						this.handleRestStart.bind(this, ctx, sectionInfo, workoutId)
					);
				}
			},

			onSetFinish: async (exerciseIndex: number, setIndex: number): Promise<void> => {
				currentParsed = await this.handleSetFinish(
					exerciseIndex,
					setIndex,
					currentParsed,
					ctx,
					sectionInfo,
					workoutId,
					async (exIdx: number, restDur: number) => {
						await this.handleRestStart(ctx, sectionInfo, workoutId, exIdx, restDur);
					}
				);
			},

			onRestStart: async (exerciseIndex: number, restDuration: number): Promise<void> => {
				await this.handleRestStart(ctx, sectionInfo, workoutId, exerciseIndex, restDuration);
			},

			onRestEnd: async (exerciseIndex: number): Promise<void> => {
				currentParsed = await this.handleRestEnd(exerciseIndex, currentParsed, ctx, sectionInfo, workoutId);
			},

			onExerciseAddSet: async (exerciseIndex: number): Promise<void> => {
				// User wants to add a set to current exercise while working out
				// This records the current set duration before creating a new one
				const exercise = currentParsed.exercises[exerciseIndex];
				if (!exercise) return;

				const activeSetIndex = this.timerManager.getActiveSetIndex(workoutId);
				const timerState = this.timerManager.getTimerState(workoutId);
				if (timerState) {
					currentParsed = setSetRecordedDuration(
						currentParsed,
						exerciseIndex,
						activeSetIndex,
						formatDurationHuman(timerState.exerciseElapsed)
					);
				}

				// Mark current set done and activate the new set
				currentParsed = updateSetState(currentParsed, exerciseIndex, activeSetIndex, 'completed');
				currentParsed = addSet(currentParsed, exerciseIndex);

				const newSetIndex = currentParsed.exercises[exerciseIndex]?.sets.length || 0 - 1;
				currentParsed = updateSetState(currentParsed, exerciseIndex, newSetIndex, 'inProgress');

				// Update timer to track new set
				this.timerManager.advanceSet(workoutId, exerciseIndex, newSetIndex);
				await updateFile(currentParsed);
			},

			onExerciseAddRest: async (exerciseIndex: number): Promise<void> => {
				// User wants to insert a rest period (creates a new rest exercise after current one)
				const exercise = currentParsed.exercises[exerciseIndex];
				const restDuration = currentParsed.metadata.restDuration;
				if (!exercise || !restDuration) return;

				const activeSetIndex = this.timerManager.getActiveSetIndex(workoutId);
				const timerState = this.timerManager.getTimerState(workoutId);
				
				// Record how long the current set took
				if (timerState) {
					currentParsed = setSetRecordedDuration(
						currentParsed,
						exerciseIndex,
						activeSetIndex,
						formatDurationHuman(timerState.exerciseElapsed)
					);
				}

				// Mark current set done, insert rest exercise at next position
				currentParsed = updateSetState(currentParsed, exerciseIndex, activeSetIndex, 'completed');
				currentParsed = addRest(currentParsed, exerciseIndex, restDuration);
				currentParsed = updateExerciseState(currentParsed, exerciseIndex + 1, 'inProgress');

				// Update timer to track new rest exercise
				this.timerManager.advanceSet(workoutId, exerciseIndex + 1, 0);
				await updateFile(currentParsed);
			},

			onExerciseSkip: async (exerciseIndex: number): Promise<void> => {
				// User wants to skip current set/exercise
				currentParsed = await this.handleExerciseSkip(exerciseIndex, currentParsed, ctx, sectionInfo, workoutId);
			},

			onParamChange: (exerciseIndex: number, paramKey: string, newValue: string): void => {
				// User edited an exercise param (e.g., weight, reps)
				// Mark as pending change (debounced - won't save until blur/flush)
				const exercise = currentParsed.exercises[exerciseIndex];
				const param = exercise?.params.find(p => p.key === paramKey);
				if (param?.value === newValue) return; // No change, skip
				currentParsed = updateParamValue(currentParsed, exerciseIndex, paramKey, newValue);
				hasPendingChanges = true; // Flag for later flush
			},

			onSetParamChange: (exerciseIndex: number, setIndex: number, paramKey: string, newValue: string): void => {
				// User edited a set param (e.g., duration, weight, reps)
				// Mark as pending change (debounced - won't save until blur/flush)
				const exercise = currentParsed.exercises[exerciseIndex];
				const set = exercise?.sets[setIndex];
				const param = set?.params.find(p => p.key === paramKey);
				if (param?.value === newValue) return; // No change, skip
				currentParsed = updateSetParamValue(currentParsed, exerciseIndex, setIndex, paramKey, newValue);
				hasPendingChanges = true; // Flag for later flush
			},

			onFlushChanges: flushChanges,

			onPauseExercise: (): void => {
				// User paused the timer (stops counting but doesn't finish/advance)
				this.timerManager.pauseExercise(workoutId);
			},

			onResumeExercise: (): void => {
				// User resumed the paused timer to continue counting
				this.timerManager.resumeExercise(workoutId);
			},

			onAddSample: async (): Promise<void> => {
				// User clicked "Load Sample" - creates a demo workout to explore features
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

	/**
	 * Handles rest period initiation: starts the rest timer in the timer manager.
	 * Called after a set is completed if a rest period is defined.
	 */
	private async handleRestStart(
		ctx: MarkdownPostProcessorContext,
		sectionInfo: SectionInfo | null,
		workoutId: string,
		exerciseIndex: number,
		restDuration: number
	): Promise<void> {
		// Start counting down the rest period
		this.timerManager.startRest(workoutId, restDuration);
	}

	/**
	 * Formats a date into workout metadata format: YYYY-MM-DD HH:MM
	 * Used for recording workout start time.
	 */
	private formatStartDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		return `${year}-${month}-${day} ${hours}:${minutes}`;
	}
}
