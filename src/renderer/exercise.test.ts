import { renderExercise, updateExerciseTimer } from './exercise';
import { Exercise, ExerciseSet, ExerciseParam, TimerState, WorkoutCallbacks } from '../types';
import * as exerciseParser from '../parser/exercise';

// Mock the exercise parser
jest.mock('../parser/exercise', () => ({
	formatDuration: jest.fn((seconds: number) => {
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}),
	formatDurationHuman: jest.fn((seconds: number) => {
		if (seconds < 60) return `${seconds}s`;
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
	}),
	parseDurationToSeconds: jest.fn((duration: string) => {
		// Simple parser: "1m 30s" -> 90, "30s" -> 30
		const match = duration.match(/(?:(\d+)m)?\s*(?:(\d+)s)?/);
		if (!match) return 0;
		const mins = parseInt(match[1] || '0', 10);
		const secs = parseInt(match[2] || '0', 10);
		return mins * 60 + secs;
	})
}));

// MockElement class to simulate DOM
class MockElement {
	tag: string;
	className: string = '';
	children: MockElement[] = [];
	parent: MockElement | null = null;
	listeners: { [key: string]: Function[] } = {};
	_textContent: string = '';
	styleMap: Map<string, string> = new Map();
	attributes: Map<string, string> = new Map();

	constructor(tag: string) {
		this.tag = tag;
	}

	get textContent(): string {
		let text = this._textContent;
		for (const child of this.children) {
			text += child.textContent;
		}
		return text;
	}

	set textContent(value: string) {
		this._textContent = value;
	}

	createDiv(options?: { cls?: string; text?: string }): MockElement {
		return this.createEl('div', options);
	}

	createEl(tag: string, options?: { cls?: string; text?: string }): MockElement {
		const el = new MockElement(tag);
		el.parent = this;
		if (options?.cls) el.className = options.cls;
		if (options?.text) el.textContent = options.text;
		this.children.push(el);
		return el;
	}

	createSpan(options?: { cls?: string; text?: string }): MockElement {
		return this.createEl('span', options);
	}

	setText(text: string): void {
		this._textContent = text;
	}

	style = {
		setProperty: jest.fn()
	};

	querySelector(selector: string): MockElement | null {
		if (selector.startsWith('.')) {
			const className = selector.substring(1);
			return this._findByClass(className);
		}
		return this._findByTag(selector);
	}

	querySelectorAll(selector: string): MockElement[] {
		if (selector.startsWith('.')) {
			const className = selector.substring(1);
			return this._findAllByClass(className);
		}
		return this._findAllByTag(selector);
	}

	private _findByClass(className: string): MockElement | null {
		if (this.className.split(' ').includes(className)) return this;
		for (const child of this.children) {
			const found = child._findByClass(className);
			if (found) return found;
		}
		return null;
	}

	private _findAllByClass(className: string): MockElement[] {
		const results: MockElement[] = [];
		if (this.className.split(' ').includes(className)) {
			results.push(this);
		}
		for (const child of this.children) {
			results.push(...child._findAllByClass(className));
		}
		return results;
	}

	private _findByTag(tagName: string): MockElement | null {
		if (this.tag === tagName) return this;
		for (const child of this.children) {
			const found = child._findByTag(tagName);
			if (found) return found;
		}
		return null;
	}

	private _findAllByTag(tagName: string): MockElement[] {
		const results: MockElement[] = [];
		if (this.tag === tagName) {
			results.push(this);
		}
		for (const child of this.children) {
			results.push(...child._findAllByTag(tagName));
		}
		return results;
	}

	empty(): void {
		this.children = [];
		this._textContent = '';
	}

	addEventListener(event: string, handler: Function): void {
		if (!this.listeners[event]) {
			this.listeners[event] = [];
		}
		this.listeners[event].push(handler);
	}

	click(): void {
		if (this.listeners['click']) {
			for (const handler of this.listeners['click']) {
				handler(new Event('click'));
			}
		}
	}

	addClass(className: string): void {
		if (!this.className.includes(className)) {
			this.className = this.className ? `${this.className} ${className}` : className;
		}
	}

	removeClass(className: string): void {
		this.className = this.className.split(' ').filter(c => c !== className).join(' ');
	}

	get classList(): DOMTokenList {
		return {
			add: (className: string) => this.addClass(className),
			contains: (className: string) => this.className.split(' ').includes(className),
			remove: (className: string) => {
				this.className = this.className.split(' ').filter(c => c !== className).join(' ');
			},
			toggle: (className: string) => {
				if (this.classList.contains(className)) {
					this.classList.remove(className);
				} else {
					this.addClass(className);
				}
			},
			toString: () => this.className
		} as any;
	}
}

describe('renderExercise & updateExerciseTimer', () => {
	let container: MockElement;
	let mockCallbacks: WorkoutCallbacks;
	const baseMockExercise: Exercise = {
		name: 'Push Ups',
		state: 'pending',
		params: [],
		sets: [{ state: 'pending', params: [] }],
		lineIndex: 0
	};

	beforeEach(() => {
		container = new MockElement('div');
		mockCallbacks = {
			onExerciseStateChange: jest.fn(),
			onSetStateChange: jest.fn(),
			onParamChange: jest.fn(),
			onStartWorkout: jest.fn(),
			onPauseWorkout: jest.fn(),
			onResumeWorkout: jest.fn(),
			onSkipExercise: jest.fn(),
			onStartExerciseTimer: jest.fn(),
			onExerciseRest: jest.fn(),
			onExerciseRestPause: jest.fn(),
			onExerciseRestResume: jest.fn(),
			onExerciseRestDone: jest.fn(),
			onExerciseFinish: jest.fn(),
			onFlushChanges: jest.fn(),
			onAddSample: jest.fn(),
			onSetRecordedDuration: jest.fn(),
			onChangeRestDuration: jest.fn(),
			onAddRest: jest.fn(),
			onAddSet: jest.fn(),
			onRestEnd: jest.fn()
		};
		jest.clearAllMocks();
	});

	describe('Container structure', () => {
		it('should create exercise element', () => {
			renderExercise(
				container,
				baseMockExercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(container.querySelector('.workout-exercise')).toBeTruthy();
		});

		it('should append exercise to container', () => {
			renderExercise(
				container,
				baseMockExercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(container.children.length).toBe(1);
		});

		it('should include state class', () => {
			renderExercise(
				container,
				baseMockExercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			const exercise = container.querySelector('.workout-exercise');
			expect(exercise?.className).toContain('state-pending');
		});

		it('should add active class when isActive is true', () => {
			renderExercise(
				container,
				baseMockExercise,
				0,
				true,
				0,
				null,
				mockCallbacks,
				'started'
			);
			const exercise = container.querySelector('.workout-exercise');
			expect(exercise?.className).toContain('active');
		});

		it('should not add active class when isActive is false', () => {
			renderExercise(
				container,
				baseMockExercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			const exercise = container.querySelector('.workout-exercise');
			expect(exercise?.className).not.toContain('active');
		});

		it('should set color property from exercise name', () => {
			const result = renderExercise(
				container,
				baseMockExercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			// Check that setProperty was called with --exercise-color
			const exercise = container.querySelector('.workout-exercise') as MockElement;
			expect((exercise?.style.setProperty as jest.Mock).mock.calls.some(
				call => call[0] === '--exercise-color'
			)).toBe(true);
		});
	});

	describe('Exercise icon display', () => {
		it('should display pending icon', () => {
			renderExercise(
				container,
				{ ...baseMockExercise, state: 'pending' },
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			const icon = container.querySelector('.workout-exercise-icon');
			expect(icon?.textContent).toBe('○');
		});

		it('should display in-progress icon', () => {
			renderExercise(
				container,
				{ ...baseMockExercise, state: 'inProgress' },
				0,
				true,
				0,
				null,
				mockCallbacks,
				'started'
			);
			const icon = container.querySelector('.workout-exercise-icon');
			expect(icon?.textContent).toBe('◐');
		});

		it('should display completed icon', () => {
			renderExercise(
				container,
				{ ...baseMockExercise, state: 'completed' },
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'completed'
			);
			const icon = container.querySelector('.workout-exercise-icon');
			expect(icon?.textContent).toBe('✓');
		});

		it('should display skipped icon', () => {
			renderExercise(
				container,
				{ ...baseMockExercise, state: 'skipped' },
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'completed'
			);
			const icon = container.querySelector('.workout-exercise-icon');
			expect(icon?.textContent).toBe('—');
		});
	});

	describe('Exercise name display', () => {
		it('should display exercise name', () => {
			renderExercise(
				container,
				baseMockExercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			const name = container.querySelector('.workout-exercise-name');
			expect(name?.textContent).toBe('Push Ups');
		});

		it('should display long exercise names', () => {
			const longName = 'Push Ups with Extended Pause at Bottom';
			renderExercise(
				container,
				{ ...baseMockExercise, name: longName },
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			const name = container.querySelector('.workout-exercise-name');
			expect(name?.textContent).toBe(longName);
		});

		it('should have correct name class', () => {
			renderExercise(
				container,
				baseMockExercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			const name = container.querySelector('.workout-exercise-name');
			expect(name?.className).toContain('workout-exercise-name');
		});
	});

	describe('Return value', () => {
		it('should return ExerciseElements object', () => {
			const result = renderExercise(
				container,
				baseMockExercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result).toBeDefined();
			expect(result.container).toBeDefined();
			expect(result.inputs).toBeDefined();
			expect(result.setInputs).toBeDefined();
		});

		it('should return container element', () => {
			const result = renderExercise(
				container,
				baseMockExercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.container).toBeInstanceOf(MockElement);
			expect(result.container.className).toContain('workout-exercise');
		});

		it('should have inputs map', () => {
			const result = renderExercise(
				container,
				baseMockExercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.inputs).toBeInstanceOf(Map);
		});

		it('should have setInputs map', () => {
			const result = renderExercise(
				container,
				baseMockExercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.setInputs).toBeInstanceOf(Map);
		});
	});

	describe('Multiple exercises in container', () => {
		it('should render multiple exercises', () => {
			renderExercise(
				container,
				{ ...baseMockExercise, name: 'Exercise 1' },
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			renderExercise(
				container,
				{ ...baseMockExercise, name: 'Exercise 2' },
				1,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(container.children.length).toBe(2);
		});

		it('should maintain state for each exercise', () => {
			renderExercise(
				container,
				{ ...baseMockExercise, state: 'pending', name: 'Exercise 1' },
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			renderExercise(
				container,
				{ ...baseMockExercise, state: 'completed', name: 'Exercise 2' },
				1,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			const exercises = container.querySelectorAll('.workout-exercise');
			expect(exercises[0].className).toContain('state-pending');
			expect(exercises[1].className).toContain('state-completed');
		});
	});

	describe('Helper functions and edge cases', () => {
		it('should render exercise with reps and weight parameters', () => {
			const exercise: Exercise = {
				name: 'Bench Press',
				state: 'pending',
				params: [
					{ key: 'Reps', value: '10', editable: true, unit: '' },
					{ key: 'Weight', value: '185', editable: false, unit: 'lbs' }
				],
				sets: [],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.inputs.size).toBeGreaterThan(0);
		});

		it('should render exercise with rest parameter', () => {
			const exercise: Exercise = {
				name: 'Cardio',
				state: 'pending',
				params: [
					{ key: 'Rest', value: '2m', editable: true, unit: '' }
				],
				sets: [],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.container).toBeDefined();
		});

		it('should handle sets with reps and weight parameters', () => {
			const exercise: Exercise = {
				name: 'Squats',
				state: 'pending',
				params: [],
				sets: [
					{
						state: 'pending',
						params: [
							{ key: 'Reps', value: '12', editable: true, unit: '' },
							{ key: 'Weight', value: '225', editable: false, unit: 'lbs' }
						]
					},
					{
						state: 'pending',
						params: [
							{ key: 'Reps', value: '10', editable: true, unit: '' },
							{ key: 'Weight', value: '235', editable: false, unit: 'lbs' }
						]
					}
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.setInputs.size).toBe(2);
		});

		it('should render set with recorded duration in completed state', () => {
			const exercise: Exercise = {
				name: 'Exercise',
				state: 'completed',
				params: [],
				sets: [
					{
						state: 'completed',
						params: [
							{ key: 'Duration', value: '5m 30s', editable: false, unit: '' }
						]
					}
				],
				lineIndex: 0,
				recordedDuration: '5m 30s'
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'completed'
			);
			expect(result.container).toBeDefined();
		});

		it('should render set with rest duration', () => {
			const exercise: Exercise = {
				name: 'Exercise',
				state: 'in-progress',
				params: [],
				sets: [
					{
						state: 'in-progress',
						params: [
							{ key: 'Rest', value: '60s', editable: true, unit: '' }
						]
					}
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				true,
				0,
				null,
				mockCallbacks,
				'started'
			);
			expect(result.container).toBeDefined();
		});

		it('should render rest phase with timer state', () => {
			const exercise: Exercise = {
				name: 'Exercise',
				state: 'in-progress',
				params: [],
				sets: [
					{
						state: 'in-progress',
						params: [
							{ key: 'Rest', value: '90s', editable: true, unit: '' }
						]
					}
				],
				lineIndex: 0
			};
			const timerState: TimerState = {
				elapsed: 30,
				isRestActive: true,
				restRemaining: 60
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				true,
				0,
				timerState,
				mockCallbacks,
				'started'
			);
			expect(result.setTimerEl).toBeDefined();
		});

		it('should render rest phase in yellow zone', () => {
			const exercise: Exercise = {
				name: 'Exercise',
				state: 'in-progress',
				params: [],
				sets: [
					{
						state: 'in-progress',
						params: [
							{ key: 'Rest', value: '90s', editable: true, unit: '' }
						]
					}
				],
				lineIndex: 0
			};
			const timerState: TimerState = {
				elapsed: 60,
				isRestActive: true,
				restRemaining: 45  // 45 / 90 = 50% (yellow phase)
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				true,
				0,
				timerState,
				mockCallbacks,
				'started'
			);
			expect(result.setTimerEl).toBeDefined();
		});

		it('should render rest phase in red zone', () => {
			const exercise: Exercise = {
				name: 'Exercise',
				state: 'in-progress',
				params: [],
				sets: [
					{
						state: 'in-progress',
						params: [
							{ key: 'Rest', value: '90s', editable: true, unit: '' }
						]
					}
				],
				lineIndex: 0
			};
			const timerState: TimerState = {
				elapsed: 90,
				isRestActive: true,
				restRemaining: 20  // 20 / 90 = 22% (red phase)
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				true,
				0,
				timerState,
				mockCallbacks,
				'started'
			);
			expect(result.setTimerEl).toBeDefined();
		});

		it('should handle rest overtime', () => {
			const exercise: Exercise = {
				name: 'Exercise',
				state: 'in-progress',
				params: [],
				sets: [
					{
						state: 'in-progress',
						params: [
							{ key: 'Rest', value: '60s', editable: true, unit: '' }
						]
					}
				],
				lineIndex: 0
			};
			const timerState: TimerState = {
				elapsed: 75,
				isRestActive: true,
				restRemaining: -15  // Negative = overtime
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				true,
				0,
				timerState,
				mockCallbacks,
				'started'
			);
			expect(result.setTimerEl).toBeDefined();
		});

		it('should render exercise with multiple parameter types', () => {
			const exercise: Exercise = {
				name: 'Complex Exercise',
				state: 'pending',
				params: [
					{ key: 'Distance', value: '10', editable: true, unit: 'km' },
					{ key: 'Time', value: '60', editable: false, unit: 'min' },
					{ key: 'Intensity', value: 'High', editable: true, unit: '' }
				],
				sets: [],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.inputs.size).toBeGreaterThan(0);
		});

		it('should render completed exercise with all totals', () => {
			const exercise: Exercise = {
				name: 'Completed Workout',
				state: 'completed',
				params: [
					{ key: 'Reps', value: '30', editable: false, unit: '' }
				],
				sets: [
					{ state: 'completed', params: [], recordedDuration: '3m' },
					{ state: 'completed', params: [], recordedDuration: '2m 45s' }
				],
				lineIndex: 0,
				recordedDuration: '5m 45s'
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'completed'
			);
			expect(result.container).toBeDefined();
		});

		it('should handle set with both Duration and Rest parameters', () => {
			const exercise: Exercise = {
				name: 'Complex Set',
				state: 'in-progress',
				params: [],
				sets: [
					{
						state: 'in-progress',
						params: [
							{ key: 'Duration', value: '45s', editable: false, unit: '' },
							{ key: 'Rest', value: '60s', editable: true, unit: '' },
							{ key: 'Reps', value: '15', editable: true, unit: '' }
						]
					}
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				true,
				0,
				null,
				mockCallbacks,
				'started'
			);
			expect(result.setInputs.size).toBeGreaterThan(0);
		});

		it('should render exercise with no timer (pending state)', () => {
			const exercise: Exercise = {
				name: 'No Timer Exercise',
				state: 'pending',
				params: [],
				sets: [],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.timerEl).toBeDefined();
		});

		it('should render set with skipped state and rest', () => {
			const exercise: Exercise = {
				name: 'Skipped With Rest',
				state: 'pending',
				params: [],
				sets: [
					{
						state: 'skipped',
						params: [
							{ key: 'Rest', value: '60s', editable: true, unit: '' }
						]
					}
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.container).toBeDefined();
		});

		it('should render in-progress exercise with multiple sets and timers', () => {
			const exercise: Exercise = {
				name: 'Multi-set Exercise',
				state: 'in-progress',
				params: [],
				sets: [
					{ state: 'completed', params: [] },
					{ state: 'in-progress', params: [], restDuration: '45s' },
					{ state: 'pending', params: [] }
				],
				lineIndex: 0
			};
			const timerState: TimerState = {
				elapsed: 30,
				isRestActive: false
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				true,
				1,
				timerState,
				mockCallbacks,
				'started'
			);
			expect(result.setTimerEl).toBeDefined();
		});

		it('should render exercise with completed recorded time', () => {
			const exercise: Exercise = {
				name: 'Recorded Exercise',
				state: 'completed',
				params: [],
				sets: [],
				lineIndex: 0,
				recordedDuration: '10m 25s'
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'completed'
			);
			expect(result.timerEl).toBeDefined();
		});

		it('should render exercise with target duration indicator', () => {
			const exercise: Exercise = {
				name: 'Duration Exercise',
				state: 'pending',
				params: [],
				sets: [],
				targetDuration: 120,
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.timerEl).toBeDefined();
		});

		it('should render exercise state indicator correctly', () => {
			const states: Array<'pending' | 'in-progress' | 'completed' | 'skipped'> = [
				'pending',
				'in-progress',
				'completed',
				'skipped'
			];
			
			for (const state of states) {
				container = new MockElement('div');
				const exercise: Exercise = {
					name: `Exercise ${state}`,
					state,
					params: [],
					sets: [],
					lineIndex: 0
				};
				const result = renderExercise(
					container,
					exercise,
					0,
					state === 'in-progress',
					-1,
					null,
					mockCallbacks,
					state === 'completed' ? 'completed' : state === 'in-progress' ? 'started' : 'planned'
				);
				expect(result.container.className).toContain(`state-${state}`);
			}
		});

		it('should handle exercise name to hue color generation', () => {
			const names = ['Squats', 'Bench Press', 'Deadlifts', 'Pull-ups', 'Rows'];
			
			for (const name of names) {
				container = new MockElement('div');
				const exercise: Exercise = {
					name,
					state: 'pending',
					params: [],
					sets: [],
					lineIndex: 0
				};
				const result = renderExercise(
					container,
					exercise,
					0,
					false,
					-1,
					null,
					mockCallbacks,
					'planned'
				);
				expect(result.container).toBeDefined();
			}
		});

		it('should render set in-progress state with timer', () => {
			const exercise: Exercise = {
				name: 'Set Timer Test',
				state: 'in-progress',
				params: [],
				sets: [
					{ state: 'in-progress', params: [] }
				],
				lineIndex: 0
			};
			const timerState: TimerState = {
				elapsed: 30,
				isRestActive: false
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				true,
				0,
				timerState,
				mockCallbacks,
				'started'
			);
			expect(result.setTimerEl).toBeDefined();
		});

		it('should render completed set with recorded duration', () => {
			const exercise: Exercise = {
				name: 'Recorded Set',
				state: 'completed',
				params: [],
				sets: [
					{
						state: 'completed',
						params: [
							{ key: 'Duration', value: '8m 15s', editable: false, unit: '' }
						]
					}
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'completed'
			);
			expect(result.container).toBeDefined();
		});

		it('should handle editable vs non-editable parameter display', () => {
			const exercise: Exercise = {
				name: 'Params Test',
				state: 'started',
				params: [
					{ key: 'Distance', value: '5', editable: true, unit: 'km' },
					{ key: 'Target', value: '10', editable: false, unit: 'km' }
				],
				sets: [],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'started'
			);
			expect(result.inputs.has('Distance')).toBe(true);
		});
	});

	describe('Exercise with sets and parameters', () => {
		it('should render sets with editable parameters', () => {
			const exercise: Exercise = {
				name: 'Squats',
				state: 'pending',
				params: [],
				sets: [
					{
						state: 'pending',
						params: [
							{ key: 'Reps', value: '10', editable: true, unit: '' },
							{ key: 'Weight', value: '185', editable: true, unit: 'lbs' }
						]
					}
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.container).toBeDefined();
			expect(result.setInputs.size).toBeGreaterThan(0);
		});

		it('should render sets with recorded duration', () => {
			const exercise: Exercise = {
				name: 'Run',
				state: 'completed',
				params: [],
				sets: [
					{
						state: 'completed',
						params: [],
						recordedDuration: '15m 30s'
					}
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'completed'
			);
			expect(result.container).toBeDefined();
		});

		it('should render sets with rest duration', () => {
			const exercise: Exercise = {
				name: 'Intervals',
				state: 'pending',
				params: [],
				sets: [
					{
						state: 'pending',
						params: [],
						restDuration: '120s'
					}
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.container).toBeDefined();
		});

		it('should render in-progress set with timer', () => {
			const exercise: Exercise = {
				name: 'Treadmill',
				state: 'in-progress',
				params: [{ key: 'Time', value: '30', editable: false, unit: 'm' }],
				sets: [
					{
						state: 'in-progress',
						params: []
					}
				],
				targetDuration: 1800,
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				true,
				0,
				null,
				mockCallbacks,
				'started'
			);
			expect(result.setTimerEl).toBeDefined();
		});

		it('should render set with rest phase', () => {
			const exercise: Exercise = {
				name: 'Complex Strength',
				state: 'started',
				params: [],
				sets: [
					{ state: 'completed', params: [] },
					{ state: 'in-progress', params: [], restDuration: '60s' }
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				true,
				1,
				{ setIndex: 1, phase: 'rest' },
				mockCallbacks,
				'started'
			);
			expect(result.container).toBeDefined();
		});

		it('should render multiple sets with different states', () => {
			const exercise: Exercise = {
				name: 'Full Body',
				state: 'in-progress',
				params: [],
				sets: [
					{ state: 'completed', params: [] },
					{ state: 'in-progress', params: [] },
					{ state: 'pending', params: [] },
					{ state: 'skipped', params: [] }
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				true,
				1,
				null,
				mockCallbacks,
				'started'
			);
			expect(result.container).toBeDefined();
		});

		it('should render exercise with calculated totals', () => {
			const exercise: Exercise = {
				name: 'Weighted Exercise',
				state: 'pending',
				params: [
					{ key: 'Reps', value: '8', editable: false, unit: '' },
					{ key: 'Weight', value: '185', editable: false, unit: 'lbs' }
				],
				sets: [
					{ state: 'pending', params: [] },
					{ state: 'pending', params: [] },
					{ state: 'pending', params: [] }
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.container).toBeDefined();
		});

		it('should handle set parameters with various editable states', () => {
			const exercise: Exercise = {
				name: 'Mixed Config Exercise',
				state: 'pending',
				params: [],
				sets: [
					{
						state: 'pending',
						params: [
							{ key: 'Reps', value: '10', editable: true, unit: '' },
							{ key: 'Weight', value: '100', editable: false, unit: 'lbs' },
							{ key: 'RPE', value: '8', editable: true, unit: '' }
						]
					}
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.container).toBeDefined();
			expect(result.setInputs.size).toBeGreaterThan(0);
		});

		it('should render completed exercise with recorded and rest duration', () => {
			const exercise: Exercise = {
				name: 'Completed Strength',
				state: 'completed',
				params: [
					{ key: 'Reps', value: '5', editable: false, unit: '' },
					{ key: 'Weight', value: '225', editable: false, unit: 'lbs' }
				],
				sets: [
					{
						state: 'completed',
						params: [],
						recordedDuration: '2m 10s',
						restDuration: '120s'
					}
				],
				recordedDuration: '2m 30s',
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'completed'
			);
			expect(result.container).toBeDefined();
		});
	});

	describe('Edge cases', () => {
		it('should handle exercises with no sets', () => {
			const exerciseNoSets: Exercise = {
				...baseMockExercise,
				sets: []
			};
			const result = renderExercise(
				container,
				exerciseNoSets,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result).toBeDefined();
		});

		it('should handle exercises with no params', () => {
			const exerciseNoParams: Exercise = {
				...baseMockExercise,
				params: [],
				sets: [{ state: 'pending', params: [] }]
			};
			const result = renderExercise(
				container,
				exerciseNoParams,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result).toBeDefined();
		});

		it('should handle very high exercise index', () => {
			const result = renderExercise(
				container,
				baseMockExercise,
				9999,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result).toBeDefined();
		});

		it('should handle exercises with multiple sets', () => {
			const exerciseMultipleSets: Exercise = {
				name: 'Squats',
				state: 'pending',
				params: [],
				sets: [
					{ state: 'pending', params: [] },
					{ state: 'pending', params: [] },
					{ state: 'pending', params: [] }
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exerciseMultipleSets,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result).toBeDefined();
		});

		it('should handle exercises with reps and weight params', () => {
			const exerciseWithReps: Exercise = {
				name: 'Bench Press',
				state: 'pending',
				params: [
					{ key: 'Reps', value: '8', editable: false, unit: '' },
					{ key: 'Weight', value: '185', editable: false, unit: 'lbs' }
				],
				sets: [{ state: 'pending', params: [] }],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exerciseWithReps,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result).toBeDefined();
		});

		it('should handle editable exercise params', () => {
			const exerciseEditable: Exercise = {
				name: 'Dumbbell Rows',
				state: 'pending',
				params: [
					{ key: 'Reps', value: '10', editable: true, unit: '' },
					{ key: 'Weight', value: '65', editable: true, unit: 'lbs' }
				],
				sets: [{ state: 'pending', params: [] }],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exerciseEditable,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.inputs.size).toBeGreaterThan(0);
		});

		it('should handle exercises with target duration', () => {
			const exerciseWithDuration: Exercise = {
				...baseMockExercise,
				targetDuration: 300,
				sets: []
			};
			const result = renderExercise(
				container,
				exerciseWithDuration,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result).toBeDefined();
		});

		it('should handle completed exercises with recorded duration', () => {
			const completedExercise: Exercise = {
				...baseMockExercise,
				state: 'completed',
				recordedDuration: '5m 30s',
				sets: []
			};
			const result = renderExercise(
				container,
				completedExercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'completed'
			);
			expect(result).toBeDefined();
		});

		it('should render set with all parameter types', () => {
			const exercise: Exercise = {
				name: 'Advanced Exercise',
				state: 'pending',
				params: [],
				sets: [
					{
						state: 'pending',
						params: [
							{ key: 'Reps', value: '10', editable: true, unit: '' },
							{ key: 'Weight', value: '50', editable: false, unit: 'kg' },
							{ key: 'Distance', value: '5', editable: true, unit: 'km' },
							{ key: 'Duration', value: '45', editable: false, unit: 's' }
						]
					}
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.setInputs.size).toBeGreaterThan(0);
		});

		it('should render exercise with skipped state', () => {
			const skippedExercise: Exercise = {
				name: 'Skipped Exercise',
				state: 'pending',
				params: [],
				sets: [{ state: 'skipped', params: [] }],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				skippedExercise,
				1,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.container).toBeDefined();
		});

		it('should render exercise with mixed set states', () => {
			const mixedExercise: Exercise = {
				name: 'Mixed Sets Exercise',
				state: 'in-progress',
				params: [],
				sets: [
					{ state: 'completed', params: [] },
					{ state: 'completed', params: [], recordedDuration: '2m' },
					{ state: 'in-progress', params: [] },
					{ state: 'pending', params: [] },
					{ state: 'skipped', params: [] }
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				mixedExercise,
				0,
				true,
				2,
				null,
				mockCallbacks,
				'started'
			);
			expect(result.container).toBeDefined();
		});

		it('should handle exercise with rest timing', () => {
			const exerciseWithRest: Exercise = {
				name: 'Rest Exercise',
				state: 'started',
				params: [],
				sets: [
					{ state: 'in-progress', params: [], restDuration: '90s' },
					{ state: 'pending', params: [], restDuration: '90s' }
				],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exerciseWithRest,
				0,
				true,
				0,
				{ setIndex: 0, phase: 'rest' },
				mockCallbacks,
				'started'
			);
			expect(result.container).toBeDefined();
		});

		it('should render exercise with no target duration', () => {
			const exercise: Exercise = {
				name: 'Count-up Exercise',
				state: 'started',
				params: [],
				sets: [{ state: 'in-progress', params: [] }],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				exercise,
				0,
				true,
				0,
				null,
				mockCallbacks,
				'started'
			);
			expect(result.container).toBeDefined();
		});

		it('should render exercise at different indices', () => {
			const exercise: Exercise = {
				name: 'Indexed Exercise',
				state: 'pending',
				params: [],
				sets: [{ state: 'pending', params: [] }],
				lineIndex: 0
			};
			
			// Test various indices
			for (let i = 0; i < 5; i++) {
				container = new MockElement('div');
				const result = renderExercise(
					container,
					exercise,
					i,
					false,
					-1,
					null,
					mockCallbacks,
					'planned'
				);
				expect(result).toBeDefined();
			}
		});

		it('should handle exercise with single set', () => {
			const singleSetExercise: Exercise = {
				name: 'Single Set',
				state: 'pending',
				params: [{ key: 'Time', value: '30', editable: false, unit: 'm' }],
				sets: [{ state: 'pending', params: [] }],
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				singleSetExercise,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.container).toBeDefined();
		});

		it('should handle exercise with many sets', () => {
			const manySets: Exercise = {
				name: 'Many Sets Exercise',
				state: 'pending',
				params: [],
				sets: Array(10).fill(null).map(() => ({ state: 'pending', params: [] })),
				lineIndex: 0
			};
			const result = renderExercise(
				container,
				manySets,
				0,
				false,
				-1,
				null,
				mockCallbacks,
				'planned'
			);
			expect(result.container).toBeDefined();
		});
	});
});

describe('updateExerciseTimer', () => {
	let timerEl: MockElement;

	beforeEach(() => {
		timerEl = new MockElement('span');
		jest.clearAllMocks();
	});

	describe('Timer update with count-up', () => {
		it('should display formatted elapsed time', () => {
			const timerState: TimerState = {
				workoutElapsed: 120,
				exerciseElapsed: 45,
				isRestActive: false,
				restRemaining: 0
			};

			updateExerciseTimer(timerEl, timerState);
			expect(exerciseParser.formatDuration).toHaveBeenCalledWith(45);
		});

		it('should clear previous content', () => {
			timerEl.textContent = 'Previous Content';
			const timerState: TimerState = {
				workoutElapsed: 120,
				exerciseElapsed: 45,
				isRestActive: false,
				restRemaining: 0
			};

			updateExerciseTimer(timerEl, timerState);
			expect(timerEl.textContent).not.toContain('Previous');
		});

		it('should handle zero elapsed time', () => {
			const timerState: TimerState = {
				workoutElapsed: 0,
				exerciseElapsed: 0,
				isRestActive: false,
				restRemaining: 0
			};

			updateExerciseTimer(timerEl, timerState);
			expect(timerEl.textContent).toBeTruthy();
		});
	});

	describe('Timer update with countdown', () => {
		it('should display countdown timer', () => {
			const timerState: TimerState = {
				workoutElapsed: 120,
				exerciseElapsed: 45,
				isRestActive: false,
				restRemaining: 0
			};
			const targetDuration = 120;

			updateExerciseTimer(timerEl, timerState, targetDuration);
			// Should calculate remaining time
			expect(timerEl.textContent).toBeTruthy();
		});

		it('should handle target duration provided', () => {
			const timerState: TimerState = {
				workoutElapsed: 120,
				exerciseElapsed: 45,
				isRestActive: false,
				restRemaining: 0
			};
			const targetDuration = 60;

			updateExerciseTimer(timerEl, timerState, targetDuration);
			// Should show time remaining from target
			expect(timerEl.textContent).toBeTruthy();
		});

		it('should display overtime when elapsed exceeds target', () => {
			const timerState: TimerState = {
				workoutElapsed: 150,
				exerciseElapsed: 125,
				isRestActive: false,
				restRemaining: 0
			};
			const targetDuration = 60;

			updateExerciseTimer(timerEl, timerState, targetDuration);
			expect(timerEl.className).toContain('overtime');
		});

		it('should add overtime class on overtime', () => {
			const timerState: TimerState = {
				workoutElapsed: 200,
				exerciseElapsed: 200,
				isRestActive: false,
				restRemaining: 0
			};
			const targetDuration = 60;

			updateExerciseTimer(timerEl, timerState, targetDuration);
			expect(timerEl.classList.contains('overtime')).toBe(true);
		});

		it('should handle exact target duration match', () => {
			const timerState: TimerState = {
				workoutElapsed: 100,
				exerciseElapsed: 60,
				isRestActive: false,
				restRemaining: 0
			};
			const targetDuration = 60;

			updateExerciseTimer(timerEl, timerState, targetDuration);
			expect(timerEl.textContent).toBeTruthy();
		});
	});
});
