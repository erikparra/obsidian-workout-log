import { TimerInstance, TimerState, TimerCallback } from '../types';

export class TimerManager {
	private timers: Map<string, TimerInstance> = new Map();
	private frameId: number | null = null;
	private lastSecond: number = 0;
	private onAutoAdvance: ((workoutId: string) => void) | null = null;
	private lastCalledState: Map<string, TimerState> = new Map();

	constructor() {
		// Track tab visibility changes
		document.addEventListener('visibilitychange', () => {
			if (!document.hidden && this.timers.size > 0) {
				// Tab just became visible - force immediate update
				this.tick();
			}
		});
	}

	setAutoAdvanceCallback(callback: (workoutId: string) => void): void {
		this.onAutoAdvance = callback;
	}

	startWorkoutTimer(workoutId: string, activeExerciseIndex: number = 0): void {
		const now = Date.now();

		const existing = this.timers.get(workoutId);
		if (existing) {
			// Resume existing timer with new exercise
			existing.exerciseStartTime = now;
			existing.exercisePausedTime = 0;
			existing.isPaused = false;
			existing.activeExerciseIndex = activeExerciseIndex;
			existing.activeSetIndex = 0;
			existing.isRestActive = false;
			existing.restPausedTime = 0;
			existing.restDuration = 0;
		} else {
			this.timers.set(workoutId, {
				workoutId,
				workoutStartTime: now,
				exerciseStartTime: now,
				exercisePausedTime: 0,
				isPaused: false,
				activeExerciseIndex,
				activeSetIndex: 0,
				isRestActive: false,
				restStartTime: now,
				restPausedTime: 0,
				restDuration: 0,
				callbacks: new Set()
			});
		}

		this.ensureFrame();
	}

	advanceExercise(workoutId: string, newExerciseIndex: number): void {
		const timer = this.timers.get(workoutId);
		if (!timer) return;

		timer.exerciseStartTime = Date.now();
		timer.exercisePausedTime = 0;
		timer.isPaused = false;
		timer.activeExerciseIndex = newExerciseIndex;
		timer.activeSetIndex = 0;
		timer.isRestActive = false;
		timer.restPausedTime = 0;
		timer.restDuration = 0;
	}

	// Advance to next set within the same exercise
	advanceSet(workoutId: string, exerciseIndex: number, setIndex: number): void {
		const timer = this.timers.get(workoutId);
		if (!timer) return;

		timer.exerciseStartTime = Date.now();
		timer.exercisePausedTime = 0;
		timer.isPaused = false;
		timer.activeExerciseIndex = exerciseIndex;
		timer.activeSetIndex = setIndex;
		timer.isRestActive = false;
		timer.restPausedTime = 0;
		timer.restDuration = 0;
	}

	// Start rest period after completing a set
	startRest(workoutId: string, restDurationSeconds: number): void {
		const timer = this.timers.get(workoutId);
		if (!timer) return;

		timer.isRestActive = true;
		timer.restStartTime = Date.now();
		timer.restPausedTime = 0;
		timer.isPaused = false;
		timer.restDuration = restDurationSeconds;
	}

	// Exit rest and advance to next set
	exitRest(workoutId: string, nextExerciseIndex: number, nextSetIndex: number): void {
		const timer = this.timers.get(workoutId);
		if (!timer) return;

		timer.isRestActive = false;
		timer.restPausedTime = 0;
		timer.restDuration = 0;
		timer.exerciseStartTime = Date.now();
		timer.exercisePausedTime = 0;
		timer.activeExerciseIndex = nextExerciseIndex;
		timer.activeSetIndex = nextSetIndex;
	}

	pauseExercise(workoutId: string): void {
		const timer = this.timers.get(workoutId);
		if (!timer || timer.isPaused) return;

		timer.isPaused = true;
		// Store how much time has passed for this exercise
		const now = Date.now();
		if (timer.isRestActive) {
			timer.restPausedTime += now - timer.restStartTime;
		} else {
			timer.exercisePausedTime += now - timer.exerciseStartTime;
		}
	}

	resumeExercise(workoutId: string): void {
		const timer = this.timers.get(workoutId);
		if (!timer || !timer.isPaused) return;

		timer.isPaused = false;
		if (timer.isRestActive) {
			timer.restStartTime = Date.now();
		} else {
			timer.exerciseStartTime = Date.now();
		}
	}

	stopWorkoutTimer(workoutId: string): void {
		this.timers.delete(workoutId);
		this.lastCalledState.delete(workoutId);

		if (this.timers.size === 0 && this.frameId !== null) {
			cancelAnimationFrame(this.frameId);
			this.frameId = null;
			this.lastSecond = 0;
		}
	}

	subscribe(workoutId: string, callback: TimerCallback): () => void {
		const timer = this.timers.get(workoutId);
		if (!timer) {
			// Timer doesn't exist, just return a no-op unsubscribe
			return () => {};
		}

		timer.callbacks.add(callback);

		// Immediately call with current state
		const state = this.getTimerState(workoutId);
		if (state) {
			callback(state);
			this.lastCalledState.set(workoutId, state);
		}

		return () => {
			timer.callbacks.delete(callback);

			// Clean up if no more subscribers
			if (timer.callbacks.size === 0) {
				this.timers.delete(workoutId);
				this.lastCalledState.delete(workoutId);

				// Cancel animation frame if no timers left
				if (this.timers.size === 0 && this.frameId !== null) {
					cancelAnimationFrame(this.frameId);
					this.frameId = null;
					this.lastSecond = 0;
				}
			}
		};
	}

	getTimerState(workoutId: string): TimerState | null {
		const timer = this.timers.get(workoutId);
		if (!timer) return null;

		const now = Date.now();

		// Total workout elapsed (always running, no pause)
		const workoutElapsed = Math.floor((now - timer.workoutStartTime) / 1000);

		// Exercise elapsed (respects pause)
		let exerciseElapsed: number;
		if (timer.isPaused) {
			exerciseElapsed = Math.floor(timer.exercisePausedTime / 1000);
		} else {
			const currentExerciseTime = now - timer.exerciseStartTime;
			exerciseElapsed = Math.floor((timer.exercisePausedTime + currentExerciseTime) / 1000);
		}

		// Rest elapsed (respects pause)
		let restElapsed: number | undefined;
		let restRemaining: number | undefined;
		
		if (timer.isRestActive) {
			if (timer.isPaused) {
				restElapsed = Math.floor(timer.restPausedTime / 1000);
			} else {
				const currentRestTime = now - timer.restStartTime;
				restElapsed = Math.floor((timer.restPausedTime + currentRestTime) / 1000);
			}
			restRemaining = Math.max(0, timer.restDuration - restElapsed);
		}

		return {
			workoutElapsed,
			exerciseElapsed,
			isOvertime: false,  // Calculated by caller with target duration
			isRestActive: timer.isRestActive,
			restElapsed,
			restRemaining
		};
	}

	getActiveExerciseIndex(workoutId: string): number {
		const timer = this.timers.get(workoutId);
		return timer?.activeExerciseIndex ?? 0;
	}

	getActiveSetIndex(workoutId: string): number {
		const timer = this.timers.get(workoutId);
		return timer?.activeSetIndex ?? 0;
	}

	setActiveExerciseIndex(workoutId: string, index: number): void {
		const timer = this.timers.get(workoutId);
		if (!timer) return;

		// Only reset exercise timer if index actually changed
		if (timer.activeExerciseIndex !== index) {
			timer.activeExerciseIndex = index;
			timer.activeSetIndex = 0;
			timer.exerciseStartTime = Date.now();
			timer.exercisePausedTime = 0;
			timer.isPaused = false;
		}
	}

	isTimerRunning(workoutId: string): boolean {
		return this.timers.has(workoutId);
	}

	// Notify all subscribers of current state immediately (used when state changes urgently need UI update)
	notifySubscribers(workoutId: string): void {
		const timer = this.timers.get(workoutId);
		if (!timer) return;

		const state = this.getTimerState(workoutId);
		if (!state) return;

		// Call all subscribers with current state and update lastCalledState
		if (this.stateChanged(workoutId, state)) {
			this.lastCalledState.set(workoutId, state);

			for (const callback of timer.callbacks) {
				callback(state);
			}
		}
	}

	isPaused(workoutId: string): boolean {
		const timer = this.timers.get(workoutId);
		return timer?.isPaused ?? false;
	}

	private ensureFrame(): void {
		if (this.frameId !== null) return;

		const scheduleNextFrame = () => {
			this.frameId = requestAnimationFrame(() => {
				this.frameId = null;

				const now = Date.now();
				const currentSecond = Math.floor(now / 1000);

				// Only process on actual second change
				if (currentSecond !== this.lastSecond) {
					this.lastSecond = currentSecond;
					this.tick();
				}

				if (this.timers.size > 0) {
					scheduleNextFrame();
				}
			});
		};

		scheduleNextFrame();
	}

	private tick(): void {
		for (const [workoutId, timer] of this.timers) {
			// Skip if no active subscribers
			if (timer.callbacks.size === 0) continue;

			const state = this.getTimerState(workoutId);
			if (!state) continue;

			// Only callback if state meaningfully changed
			if (this.stateChanged(workoutId, state)) {
				this.lastCalledState.set(workoutId, state);

				for (const callback of timer.callbacks) {
					callback(state);
				}
			}
		}
	}

	private stateChanged(workoutId: string, current: TimerState): boolean {
		const prev = this.lastCalledState.get(workoutId);
		if (!prev) return true;

		return (
			prev.exerciseElapsed !== current.exerciseElapsed ||
			prev.restRemaining !== current.restRemaining ||
			prev.isRestActive !== current.isRestActive
		);
	}

	// Called when we need to check for auto-advance (countdown completed)
	checkAutoAdvance(workoutId: string, targetDuration: number | undefined): void {
		if (targetDuration === undefined) return;

		const state = this.getTimerState(workoutId);
		if (!state) return;

		if (state.exerciseElapsed >= targetDuration && this.onAutoAdvance) {
			this.onAutoAdvance(workoutId);
		}
	}

	// Cleanup all timers
	destroy(): void {
		if (this.frameId !== null) {
			cancelAnimationFrame(this.frameId);
			this.frameId = null;
		}
		this.timers.clear();
		this.lastCalledState.clear();
	}
}
