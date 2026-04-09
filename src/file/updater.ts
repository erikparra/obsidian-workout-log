import { App, TFile } from 'obsidian';
import { SectionInfo, ParsedWorkout } from '../types';

export class FileUpdater {
	private updateLocks = new Map<string, Promise<void>>();

	constructor(private app: App) {}

	// Normalize exercise name to camelCase for property names
	private normalizeToCamelCase(name: string): string {
		return name
			.trim()
			.split(/[\s\-_]+/)  // Split on spaces, hyphens, underscores
			.map((word, index) => {
				if (index === 0) {
					return word.toLowerCase();
				}
				return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
			})
			.join('');
	}

	// Serialize updates to the same file to prevent race conditions
	private async withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
		// Wait for any pending update to complete
		const pending = this.updateLocks.get(filePath);
		if (pending) {
			await pending;
		}

		// Create a new promise for our update
		let resolve: () => void;
		const lock = new Promise<void>(r => { resolve = r; });
		this.updateLocks.set(filePath, lock);

		try {
			return await fn();
		} finally {
			resolve!();
			// Clean up if this is still our lock
			if (this.updateLocks.get(filePath) === lock) {
				this.updateLocks.delete(filePath);
			}
		}
	}

	async updateCodeBlock(
		sourcePath: string,
		sectionInfo: SectionInfo | null,
		newContent: string,
		expectedTitle?: string
	): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) {
			console.error('Workout Log: File not found:', sourcePath);
			return false;
		}

		if (!sectionInfo) {
			console.error('Workout Log: No section info available - cannot update file. Try navigating away and back.');
			return false;
		}

		let updateSucceeded = false;

		await this.withLock(sourcePath, async () => {
			await this.app.vault.process(file, (content) => {
				const lines = content.split('\n');

				// Validate that the target location still has a workout code block
				const startLine = lines[sectionInfo.lineStart];
				if (!startLine || !startLine.trim().startsWith('```workout')) {
					console.error('Workout Log: Stale sectionInfo - expected ```workout at line', sectionInfo.lineStart, '. Try navigating away and back.');
					return content; // Return unchanged
				}

				// If we have an expected title, validate it matches
				if (expectedTitle) {
					const blockContent = lines.slice(sectionInfo.lineStart + 1, sectionInfo.lineEnd).join('\n');
					const titleMatch = blockContent.match(/^title:\s*(.+)$/m);
					const actualTitle = titleMatch?.[1]?.trim();
					if (actualTitle && actualTitle !== expectedTitle) {
						console.error('Workout Log: Title mismatch - expected', expectedTitle, 'but found', actualTitle);
						return content; // Return unchanged
					}
				}

				// Find the code block boundaries
				const codeBlockStart = sectionInfo.lineStart;
				const codeBlockEnd = sectionInfo.lineEnd;

				// Replace content between the code fences (exclusive of the fences themselves)
				const beforeFence = lines.slice(0, codeBlockStart + 1);
				const afterFence = lines.slice(codeBlockEnd);

				const newLines = [
					...beforeFence,
					newContent,
					...afterFence
				];

				updateSucceeded = true;
				return newLines.join('\n');
			});
		});

		return updateSucceeded;
	}

	async insertLineAfter(
		sourcePath: string,
		sectionInfo: SectionInfo | null,
		relativeLineIndex: number,
		newLine: string
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) {
			console.error('File not found:', sourcePath);
			return;
		}

		if (!sectionInfo) {
			console.error('No section info available');
			return;
		}

		await this.app.vault.process(file, (content) => {
			const lines = content.split('\n');

			// Calculate absolute line number
			// sectionInfo.lineStart is the ```workout line
			// relativeLineIndex is relative to inside the code block
			const absoluteLineIndex = sectionInfo.lineStart + 1 + relativeLineIndex;

			// Insert the new line after the specified line
			lines.splice(absoluteLineIndex + 1, 0, newLine);

			return lines.join('\n');
		});
	}

	async saveToProperties(sourcePath: string, parsed: ParsedWorkout): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) {
			console.error('Workout Log: Cannot save to properties - file not found:', sourcePath);
			return;
		}

		// Only proceed if saveToProperties is explicitly true
		if (!parsed.metadata.saveToProperties) {
			return;
		}

		await this.withLock(sourcePath, async () => {
			// Update file properties/frontmatter
			const properties: Record<string, unknown> = {};

			const metadata = parsed.metadata;
			if (metadata.title) {
				properties.workoutTitle = metadata.title;
			}
			if (metadata.state) {
				properties.workoutState = metadata.state;
			}
			if (metadata.startDate) {
				properties.workoutStartDate = metadata.startDate;
			}
			if (metadata.duration) {
				properties.workoutDuration = metadata.duration;
			}
			if (metadata.restDuration !== undefined) {
				properties.workoutRestDuration = metadata.restDuration;
			}

			// Extract exercise data
			if (parsed.exercises.length > 0) {
				const exercises = parsed.exercises.map(exercise => ({
					name: exercise.name,
					state: exercise.state,
					recordedDuration: exercise.recordedDuration,
					sets: exercise.sets.map(set => {
						// Extract recorded duration from params if it exists
						const durationParam = set.params.find(p => p.key.toLowerCase() === 'duration' && !p.editable);
						return {
							state: set.state,
							recordedDuration: durationParam?.value
						};
					})
				}));
				properties.workoutExercises = exercises;

				// Calculate totals for each exercise and add as properties
				for (const exercise of parsed.exercises) {
					const normalizedName = this.normalizeToCamelCase(exercise.name);

					// Calculate totals from all sets of this exercise
					let totalWeight = 0;
					let totalReps = 0;
					let totalDuration = 0;

					for (const set of exercise.sets) {
						// Extract weight
						const weightParam = set.params.find(p => p.key.toLowerCase() === 'weight');
						if (weightParam && weightParam.value) {
							const weight = parseFloat(weightParam.value);
							if (!isNaN(weight)) {
								totalWeight += weight;
							}
						}

						// Extract reps
						const repsParam = set.params.find(p => p.key.toLowerCase() === 'reps');
						if (repsParam && repsParam.value) {
							const reps = parseInt(repsParam.value, 10);
							if (!isNaN(reps)) {
								totalReps += reps;
							}
						}

						// Extract duration
						const durationParam = set.params.find(p => p.key.toLowerCase() === 'duration');
						if (durationParam && durationParam.value) {
							const duration = parseInt(durationParam.value, 10);
							if (!isNaN(duration)) {
								totalDuration += duration;
							}
						}
					}

					// Add properties if any totals exist
					if (totalWeight > 0) {
						properties[`${normalizedName}TotalWeight`] = totalWeight;
					}
					if (totalReps > 0) {
						properties[`${normalizedName}TotalReps`] = totalReps;
					}
					if (totalDuration > 0) {
						properties[`${normalizedName}TotalDuration`] = totalDuration;
					}
				}
			}

			// Use Obsidian's API to set properties
			try {
				await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
					// Update or add properties to frontmatter
					Object.assign(frontmatter, properties);
				});
			} catch (error) {
				console.error('Workout Log: Failed to save properties to file:', error);
			}
		});
	}
}
