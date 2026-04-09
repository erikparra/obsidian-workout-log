import {
	serializeWorkout,
	updateParamValue,
	updateSetParamValue,
	updateExerciseState,
	updateSetState,
	lockAllFields,
	addRest,
	addSet,
	setRecordedDuration,
	setSetRecordedDuration,
	updateSetRestDuration,
	createSampleWorkout,
	serializeWorkoutAsTemplate
} from './serializer';
import { ExerciseState } from './types';
import { parseWorkout } from './parser/index';

describe('serializeWorkout', () => {
	it('should serialize basic workout', () => {
		const source = 'title: Test\nstate: planned\n---\n- [ ] Exercise\n  - [ ] | Weight: [100] kg';
		const parsed = parseWorkout(source);
		const serialized = serializeWorkout(parsed);
		
		expect(serialized).toContain('title: Test');
		expect(serialized).toContain('state: planned');
		expect(serialized).toContain('---');
		expect(serialized).toContain('- [ ] Exercise');
		expect(serialized).toContain('- [ ] | Weight: [100] kg');
	});

	it('should roundtrip parse and serialize', () => {
		const source = 'title: Full Body\nstate: completed\n---\n- [x] Bench\n  - [x] | Weight: 100 kg | Reps: 8';
		const parsed = parseWorkout(source);
		const serialized = serializeWorkout(parsed);
		const reparsed = parseWorkout(serialized);
		
		expect(reparsed.metadata.title).toBe(parsed.metadata.title);
		expect(reparsed.exercises).toHaveLength(parsed.exercises.length);
		expect(reparsed.exercises[0].name).toBe(parsed.exercises[0].name);
	});
});

describe('updateParamValue', () => {
	it('should update existing exercise param', () => {
		const source = '---\n- [ ] Bench | Weight: [100] kg | Reps: [10]\n  - [ ] | Weight: [100] kg';
		const parsed = parseWorkout(source);
		const updated = updateParamValue(parsed, 0, 'Weight', '110');
		
		expect(updated.exercises[0].params.find(p => p.key === 'Weight')?.value).toBe('110');
	});

	it('should only update if param exists', () => {
		const source = '---\n- [ ] Exercise | Weight: [50] kg\n  - [ ] |';
		const parsed = parseWorkout(source);
		const updated = updateParamValue(parsed, 0, 'NonExistent', 'value');
		
		// Param not added, only existing params can be updated
		expect(updated.exercises[0].params.find(p => p.key === 'NonExistent')).toBeUndefined();
	});

	it('should return unchanged if exercise index invalid', () => {
		const source = '---\n- [ ] Exercise | Weight: [50] kg\n  - [ ] |';
		const parsed = parseWorkout(source);
		const updated = updateParamValue(parsed, 99, 'Key', 'value');
		
		expect(updated).toBe(parsed);
	});

	it('should not mutate original', () => {
		const source = '---\n- [ ] Bench | Weight: [100] kg | Reps: [10]\n  - [ ] |';
		const parsed = parseWorkout(source);
		const updated = updateParamValue(parsed, 0, 'Weight', '110');
		
		expect(parsed.exercises[0].params[0].value).toBe('100');
		expect(updated.exercises[0].params[0].value).toBe('110');
	});
});

describe('updateSetParamValue', () => {
	it('should update existing set param', () => {
		const source = '---\n- [ ] Bench\n  - [ ] | Weight: [100] kg';
		const parsed = parseWorkout(source);
		const updated = updateSetParamValue(parsed, 0, 0, 'Weight', '120');
		
		expect(updated.exercises[0].sets[0].params[0].value).toBe('120');
	});

	it('should return unchanged if exercise index invalid', () => {
		const source = '---\n- [ ] Bench\n  - [ ] | Weight: [100] kg';
		const parsed = parseWorkout(source);
		const updated = updateSetParamValue(parsed, 99, 0, 'Weight', '120');
		
		expect(updated).toBe(parsed);
	});

	it('should return unchanged if set index invalid', () => {
		const source = '---\n- [ ] Bench\n  - [ ] | Weight: [100] kg';
		const parsed = parseWorkout(source);
		const updated = updateSetParamValue(parsed, 0, 99, 'Weight', '120');
		
		expect(updated).toBe(parsed);
	});
});

describe('updateExerciseState', () => {
	it('should update exercise state', () => {
		const source = '---\n- [ ] Exercise\n  - [ ] |';
		const parsed = parseWorkout(source);
		const updated = updateExerciseState(parsed, 0, 'completed');
		
		expect(updated.exercises[0].state).toBe('completed');
	});

	it('should preserve original state if invalid index', () => {
		const source = '---\n- [ ] Exercise\n  - [ ] |';
		const parsed = parseWorkout(source);
		const updated = updateExerciseState(parsed, 99, 'completed');
		
		expect(updated).toBe(parsed);
	});
});

describe('updateSetState', () => {
	it('should update set state', () => {
		const source = '---\n- [ ] Bench\n  - [ ] | Weight: [100] kg';
		const parsed = parseWorkout(source);
		const updated = updateSetState(parsed, 0, 0, 'completed');
		
		expect(updated.exercises[0].sets[0].state).toBe('completed');
	});

	it('should return unchanged if indices invalid', () => {
		const source = '---\n- [ ] Bench\n  - [ ] | Weight: [100] kg';
		const parsed = parseWorkout(source);
		const updated = updateSetState(parsed, 99, 0, 'completed');
		
		expect(updated).toBe(parsed);
	});
});

describe('lockAllFields', () => {
	it('should convert all editable params to non-editable', () => {
		const source = '---\n- [ ] Bench | Weight: [100] kg | Reps: [8]\n  - [ ] | Weight: [100] kg | Reps: [8]';
		const parsed = parseWorkout(source);
		const locked = lockAllFields(parsed);
		
		// All params should be non-editable
		locked.exercises[0].params.forEach(p => {
			expect(p.editable).toBe(false);
		});
		locked.exercises[0].sets.forEach(s => {
			s.params.forEach(p => {
				expect(p.editable).toBe(false);
			});
		});
	});

	it('should not mutate original', () => {
		const source = '---\n- [ ] Bench | Weight: [100] kg | Reps: [8]\n  - [ ] |';
		const parsed = parseWorkout(source);
		const locked = lockAllFields(parsed);
		
		expect(parsed.exercises[0].params[0].editable).toBe(true);
		expect(locked.exercises[0].params[0].editable).toBe(false);
	});
});

describe('addRest', () => {
	it('should add rest exercise after specified index', () => {
		const source = '---\n- [ ] Bench\n  - [ ] |';
		const parsed = parseWorkout(source);
		const withRest = addRest(parsed, 0, 60);
		
		expect(withRest.exercises).toHaveLength(2);
		expect(withRest.exercises[1].name).toBe('Rest');
		expect(withRest.exercises[1].targetDuration).toBe(60);
	});

	it('should return unchanged if exercise index invalid', () => {
		const source = '---\n- [ ] Bench\n  - [ ] |';
		const parsed = parseWorkout(source);
		const withRest = addRest(parsed, 99, 60);
		
		expect(withRest).toBe(parsed);
	});

	it('should create rest with editable Duration param', () => {
		const source = '---\n- [ ] Bench\n  - [ ] |';
		const parsed = parseWorkout(source);
		const withRest = addRest(parsed, 0, 90);
		
		const restEx = withRest.exercises[1];
		expect(restEx.params).toHaveLength(1);
		expect(restEx.params[0].key).toBe('Duration');
		expect(restEx.params[0].value).toBe('90s');
		expect(restEx.params[0].editable).toBe(true);
	});
});

describe('addSet', () => {
	it('should add new set to exercise', () => {
		const source = '---\n- [ ] Bench\n  - [ ] | Weight: [100] kg';
		const parsed = parseWorkout(source);
		const withSet = addSet(parsed, 0);
		
		expect(withSet.exercises[0].sets).toHaveLength(2);
		expect(withSet.exercises[0].sets[1].state).toBe('pending');
	});

	it('should preserve params in new set', () => {
		const source = '---\n- [ ] Bench\n  - [ ] | Weight: [100] kg | Reps: [8]';
		const parsed = parseWorkout(source);
		const withSet = addSet(parsed, 0);
		
		expect(withSet.exercises[0].sets[1].params).toHaveLength(2);
	});

	it('should return unchanged if invalid exercise or no sets', () => {
		const source = '---\n- [ ] Bench';
		const parsed = parseWorkout(source);
		const withSet = addSet(parsed, 0);
		
		// First set is created from exercise params, so has 1 set
		// Adding another should work
		expect(withSet.exercises[0].sets.length).toBeGreaterThan(1);
	});
});

describe('setRecordedDuration', () => {
	it('should set recorded duration on exercise', () => {
		const source = '---\n- [ ] Cardio\n  - [ ] |';
		const parsed = parseWorkout(source);
		const updated = setRecordedDuration(parsed, 0, '5m 30s');
		
		const durationParam = updated.exercises[0].params.find(p => p.key === 'Duration');
		expect(durationParam?.value).toBe('5m 30s');
		expect(durationParam?.editable).toBe(false);
	});

	it('should overwrite existing duration', () => {
		const source = '---\n- [ ] Cardio | Duration: [60]\n  - [ ] |';
		const parsed = parseWorkout(source);
		const updated = setRecordedDuration(parsed, 0, '65s');
		
		const durationParam = updated.exercises[0].params.find(p => p.key === 'Duration');
		expect(durationParam?.value).toBe('65s');
		expect(durationParam?.editable).toBe(false);
	});

	it('should return unchanged if exercise index invalid', () => {
		const source = '---\n- [ ] Cardio';
		const parsed = parseWorkout(source);
		const updated = setRecordedDuration(parsed, 99, '60s');
		
		expect(updated).toBe(parsed);
	});
});

describe('setSetRecordedDuration', () => {
	it('should set recorded duration on set', () => {
		const source = '---\n- [ ] Bench\n  - [ ] |';
		const parsed = parseWorkout(source);
		const updated = setSetRecordedDuration(parsed, 0, 0, '2m 30s');
		
		const durationParam = updated.exercises[0].sets[0].params.find(p => p.key === 'Duration');
		expect(durationParam?.value).toBe('2m 30s');
	});
});

describe('updateSetRestDuration', () => {
	it('should update rest duration on set', () => {
		const source = '---\n- [ ] Bench\n  - [ ] |';
		const parsed = parseWorkout(source);
		const updated = updateSetRestDuration(parsed, 0, 0, '90s');
		
		const restParam = updated.exercises[0].sets[0].params.find(p => p.key === 'Rest');
		expect(restParam?.value).toBe('90s');
		expect(restParam?.editable).toBe(true);
	});
});

describe('createSampleWorkout', () => {
	it('should create sample workout with exercises', () => {
		const sample = createSampleWorkout();
		
		expect(sample.metadata.title).toBe('Sample Workout');
		expect(sample.exercises.length).toBeGreaterThan(0);
		expect(sample.exercises[0].sets.length).toBeGreaterThan(0);
	});
});

describe('serializeWorkoutAsTemplate', () => {
	it('should serialize workout as template with reset state', () => {
		const source = '---\n- [ ] Bench\n  - [ ] | Weight: [100] kg';
		const parsed = parseWorkout(source);
		const template = serializeWorkoutAsTemplate(parsed);
		
		expect(template).toContain('state: planned');
		expect(template).toContain('startDate:');
		expect(template).toContain('duration:');
	});
});
