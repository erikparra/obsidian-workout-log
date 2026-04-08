# Nested Sets Implementation Summary

This document describes the implementation of nested sets support in the Obsidian Workout Log plugin.

## Overview

Previously, each exercise instance represented a single set. Multiple sets for the same exercise required duplicating the entire exercise line. Now, exercises can contain multiple sets as indented sub-items, enabling per-set tracking of reps and weights.

## Architecture Changes

### Type System (`types.ts`)

#### New: `ExerciseSet` Interface
```typescript
export interface ExerciseSet {
	state: ExerciseState;
	params: ExerciseParam[];
	lineIndex: number;
}
```

#### Updated: `Exercise` Interface
```typescript
export interface Exercise {
	state: ExerciseState;
	name: string;
	params: ExerciseParam[];      // Exercise-level params (typically Duration)
	sets: ExerciseSet[];          // Nested sets
	targetDuration?: number;
	recordedDuration?: string;
	lineIndex: number;
}
```

### Parser (`parser/`)

#### `parser/index.ts` - `parseWorkout()`
- Detects indentation to distinguish between parent exercises and child sets
- Groups indented lines as sets under the parent exercise
- When an exercise has no sets (backward compatibility), creates a default set from exercise params

#### `parser/exercise.ts` - New Functions
- `parseExercise()`: Now returns Exercise with `sets: []` initialized
- `parseSet()`: Parses indented lines as sets (no exercise name, just params)

#### Format Parsing Logic
```
- [ ] Exercise Name | Duration: [180s]      → Exercise with params
  - [ ] Reps: [10] | Weight: [225] lbs      → Set (converted as set params)
  - [ ] Reps: [8] | Weight: [235] lbs       → Set
```

Result: Exercise has `params: [Duration]` and `sets: [{params: [Reps, Weight]}, {params: [Reps, Weight]}]`

### Serializer (`serializer.ts`)

#### Updated Functions
- `serializeWorkout()`: Now serializes exercises + their sets
- `createSampleWorkout()`: Creates exercises with sample sets

#### New Functions
- `updateSetParamValue()`: Updates a specific param in a set
- `updateSetState()`: Updates state of a specific set
- `setSetRecordedDuration()`: Records duration for a set
- `addSet()`: Adds a new set to an exercise (modified from duplicating exercises)

#### New Exports
- `serializeSet()`: Formats a set as an indented markdown line

### Renderer (`renderer/`)

#### `renderer/index.ts`
- No major changes; uses same iteration pattern for exercises

#### `renderer/exercise.ts` - Significant Updates
- `ExerciseElements` now tracks `setInputs: Map<number, Map<string, HTMLInputElement>>`
- New `renderSet()` function: Renders each set as an indented row with checkbox and params
- Sets appear visually indented under the exercise
- Each set has its own state icon and parameter inputs

#### UI Structure
```
[○] Bench Press | Duration: 5m
  [○] Set 1    ×10  185 lbs
  [○] Set 2    ×8   185 lbs
  [○] Set 3    ×6   185 lbs
```

### Callbacks (`types.ts`)

#### New Callback
```typescript
onSetParamChange: (exerciseIndex: number, setIndex: number, paramKey: string, newValue: string) => void;
```

#### Main.ts Implementation
- Implements `onSetParamChange` to update in-memory state
- Marks changes as pending, waits for flush before saving to file

## Backward Compatibility

The implementation fully supports the old format (exercise-level params):

```
- [ ] Bench Press | Reps: [10] | Weight: [225] lbs
```

When parsed:
1. Recognized as Exercise with no indented sets
2. Automatically creates a default set containing all params
3. Serializes back with sets indented, or to legacy format if needed

## "+ Set" Button Behavior

When clicked during workout:
1. Records current set's duration (timer state)
2. Adds new pending set to exercise
3. Advances timer to new set
4. User can modify reps/weight for new set
5. "+ Next" button (or "+ Set" again) moves workflow forward

## File Update Flow

### When Set Parameters Change
1. `onSetParamChange` called → updates `currentParsed` in memory
2. Sets `hasPendingChanges = true`
3. On blur/focusout, `onFlushChanges()` → `updateFile()`
4. `serializeWorkout()` writes exercise + all sets to file

### Example Output
```
- [ ] Bench Press | Duration: [300s]
  - [ ] Reps: [10] | Weight: [225] lbs
  - [ ] Reps: [8] | Weight: [235] lbs
```

## Limitations & Future Work

### Current Limitations
- Set state is tracked but not prominently displayed during workout
- Callbacks for set-level skip, pause, etc. not yet implemented
- Timer assumes single active exercise (not per-set granularity)

### Future Enhancements
- Per-set timers with individual countdown/count-up
- Set-level skip button
- Progressive set tracking (decreasing reps/increasing weight visualization)
- Set templates (e.g., "3×10" auto-expands to 3 sets)

## Testing

### Sample Formats
See [sample-workout.md](sample-workout.md) for:
- **Upper Body Strength**: Example with nested sets
- **Full Body**: Legacy format (old single-line format)
- **Morning Mobility**: Mixed format demo

### Parsing Examples
All test cases in sample files should parse correctly to Exercise objects with nested sets.

## Code Locations

| File | Change |
|------|--------|
| `src/types.ts` | Added `ExerciseSet` interface, updated `Exercise` |
| `src/parser/index.ts` | Added set grouping logic in `parseWorkout()` |
| `src/parser/exercise.ts` | Added `parseSet()`, updated `parseExercise()`, added `serializeSet()` |
| `src/serializer.ts` | Added set-level functions, updated `createSampleWorkout()` |
| `src/renderer/exercise.ts` | Added `renderSet()`, updated `ExerciseElements` interface |
| `src/main.ts` | Added `onSetParamChange` callback implementation |
