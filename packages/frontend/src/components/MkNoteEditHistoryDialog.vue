<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialogEl"
	:width="700"
	:height="600"
	:withOkButton="false"
	@close="cancel()"
	@closed="emit('closed')"
>
	<template #header>
		<i class="ti ti-history"></i> {{ i18n.ts.viewEditHistory }}
	</template>

	<div :class="$style.root">
		<MkLoading v-if="loading" :class="$style.loading"/>
		<div v-else-if="error" :class="$style.error">
			<div :class="$style.errorIcon"><i class="ti ti-alert-circle"></i></div>
			<div>{{ i18n.ts.somethingHappened }}</div>
		</div>
		<div v-else-if="history.length === 0" :class="$style.empty">
			<div :class="$style.emptyIcon"><i class="ti ti-mood-empty"></i></div>
			<div>{{ i18n.ts.noHistory }}</div>
		</div>
		<div v-else :class="$style.timeline">
			<div
				v-for="(revision, index) in history"
				:key="revision.version"
				:class="[$style.revision, { [$style.selected]: selectedRevision === index }]"
				@click="selectRevision(index)"
			>
				<div :class="$style.revisionHeader">
					<div :class="$style.revisionMeta">
						<div :class="$style.revisionNumber">
							<i class="ti ti-circle-dot"></i>
							<span v-if="index === 0">{{ i18n.ts.currentVersion }}</span>
							<span v-else :class="$style.version">
								<span>{{ i18n.ts.version }}</span>
								<span>{{ revision.version }}</span>
							</span>
						</div>
						<MkTime :time="revision.createdAt" mode="detail"/>
					</div>
				</div>

				<div v-if="selectedRevision === index" :class="$style.revisionContent">
					<div v-if="revision.payload.cw !== undefined" :class="$style.field">
						<div :class="$style.fieldLabel">CW</div>
						<div :class="$style.fieldValue">
							<Mfm v-if="revision.payload.cw" :text="revision.payload.cw" :plain="false"/>
							<span v-else :class="$style.empty">{{ i18n.ts.none }}</span>
						</div>
					</div>

					<div v-if="revision.payload.text !== undefined" :class="$style.field">
						<div :class="$style.fieldLabel">{{ i18n.ts.text }}</div>
						<div :class="$style.fieldValue">
							<Mfm v-if="revision.payload.text" :text="revision.payload.text" :plain="false"/>
							<span v-else :class="$style.empty">{{ i18n.ts.none }}</span>
						</div>
					</div>

					<div v-if="revision.payload.visibility !== undefined" :class="$style.field">
						<div :class="$style.fieldLabel">{{ i18n.ts.visibility }}</div>
						<div :class="$style.fieldValue">
							{{ i18n.ts._visibility[revision.payload.visibility] }}
						</div>
					</div>

					<div v-if="revision.payload.fileIds !== undefined && revision.payload.fileIds.length > 0" :class="$style.field">
						<div :class="$style.fieldLabel">{{ i18n.ts.files }}</div>
						<div :class="$style.fieldValue">
							{{ i18n.tsx.withNFiles({ n: revision.payload.fileIds.length }) }}
						</div>
					</div>

					<div v-if="revision.payload.poll !== undefined && revision.payload.poll !== null" :class="$style.field">
						<div :class="$style.fieldLabel">{{ i18n.ts.poll }}</div>
						<div :class="$style.fieldValue">
							<div v-for="(choice, i) in revision.payload.poll.choices" :key="i">
								{{ choice }}
							</div>
						</div>
					</div>

					<div v-if="index < history.length - 1" :class="$style.diffSection">
						<div :class="$style.diffLabel">
							<i class="ti ti-git-compare"></i>
							{{ i18n.ts.modified }}
						</div>
						<div :class="$style.diffContent">
							<div v-for="change in getChanges(index)" :key="change.field" :class="$style.change">
								<div :class="$style.changeField">{{ change.field }}</div>
								<div :class="$style.changeValues">
									<div :class="$style.changeOld">
										<i class="ti ti-minus"></i>
										<span>{{ change.oldValue }}</span>
									</div>
									<div :class="$style.changeNew">
										<i class="ti ti-plus"></i>
										<span>{{ change.newValue }}</span>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { ref, onMounted } from 'vue';
import * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkLoading from '@/components/global/MkLoading.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	noteId: string;
	currentNote?: Misskey.entities.Note;
}>();

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

// ... 기존 코드들 ...

function cancel() {
	dialogEl.value!.close();
}

// selectRevision, getChanges 함수들...

type NoteRevision = {
	version: number;
	createdAt: string;
	editorId: string;
	payload: {
		cw?: string | null;
		text?: string | null;
		visibility?: Misskey.entities.Note['visibility'];
		fileIds?: string[];
		poll?: {
			choices: string[];
		} | null;
	};
};

const dialogEl = ref<InstanceType<typeof MkModalWindow>>();
const loading = ref(true);
const error = ref(false);
const history = ref<NoteRevision[]>([]);
const selectedRevision = ref(0);

onMounted(async () => {
	try {
		// Add current version at the top if available
		if (props.currentNote) {
			const currentRevision: NoteRevision = {
				version: 0,
				createdAt: props.currentNote.updatedAt ?? props.currentNote.createdAt,
				editorId: props.currentNote.userId,
				payload: {
					cw: props.currentNote.cw,
					text: props.currentNote.text,
					visibility: props.currentNote.visibility,
					fileIds: props.currentNote.fileIds ?? [],
					poll: props.currentNote.poll ? {
						choices: props.currentNote.poll.choices.map(c => c.text),
					} : null,
				},
			};
			history.value.push(currentRevision);
		}

		// Fetch edit history
		const revisions = await misskeyApi('notes/edit-history', {
			noteId: props.noteId,
		});

		// Merge history with current version
		for (const revision of revisions) {
			history.value.push({
				version: revision.version,
				createdAt: revision.createdAt,
				editorId: revision.editorId,
				payload: revision.payload as NoteRevision['payload'],
			});
		}
	} catch (e) {
		console.error('Failed to load edit history:', e);
		error.value = true;
	} finally {
		loading.value = false;
	}
});

function selectRevision(index: number) {
	selectedRevision.value = index;
}

function getChanges(index: number) {
	if (index >= history.value.length - 1) return [];

	const current = history.value[index];
	const previous = history.value[index + 1];
	const changes: { field: string; oldValue: string; newValue: string }[] = [];

	if (current.payload.text !== previous.payload.text) {
		changes.push({
			field: i18n.ts.text,
			oldValue: previous.payload.text ?? i18n.ts.none,
			newValue: current.payload.text ?? i18n.ts.none,
		});
	}

	if (current.payload.cw !== previous.payload.cw) {
		changes.push({
			field: 'CW',
			oldValue: previous.payload.cw ?? i18n.ts.none,
			newValue: current.payload.cw ?? i18n.ts.none,
		});
	}

	if (current.payload.visibility !== previous.payload.visibility) {
		changes.push({
			field: i18n.ts.visibility,
			oldValue: previous.payload.visibility ? i18n.ts._visibility[previous.payload.visibility] : i18n.ts.none,
			newValue: current.payload.visibility ? i18n.ts._visibility[current.payload.visibility] : i18n.ts.none,
		});
	}

	return changes;
}
</script>

<style lang="scss" module>
.root {
	padding: 16px;
}

.loading {
	display: flex;
	justify-content: center;
	align-items: center;
	min-height: 200px;
}

.error, .empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	min-height: 200px;
	gap: 16px;
	color: var(--MI_THEME-fg);
	opacity: 0.7;
}

.errorIcon, .emptyIcon {
	font-size: 48px;
}

.timeline {
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.revision {
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 8px;
	padding: 12px;
	cursor: pointer;
	transition: all 0.2s;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	&.selected {
		border-color: var(--MI_THEME-accent);
		background: var(--MI_THEME-accentedBg);
	}
}

.revisionHeader {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 12px;
}

.revisionMeta {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.revisionNumber {
	display: flex;
	align-items: center;
	gap: 8px;
	font-weight: bold;
	color: var(--MI_THEME-accent);
}

.version {
	display: inline-flex;
	gap: 0.25em;
}

.revisionEditor {
	display: flex;
	align-items: center;
	gap: 8px;
}

.editorAvatar {
	width: 24px;
	height: 24px;
}

.revisionContent {
	margin-top: 16px;
	padding-top: 16px;
	border-top: 1px solid var(--MI_THEME-divider);
}

.field {
	margin-bottom: 16px;

	&:last-child {
		margin-bottom: 0;
	}
}

.fieldLabel {
	font-size: 0.9em;
	font-weight: bold;
	margin-bottom: 8px;
	color: var(--MI_THEME-fgTransparentWeak);
}

.fieldValue {
	padding: 8px;
	background: var(--MI_THEME-panel);
	border-radius: 4px;
	word-break: break-word;
}

.empty {
	font-style: italic;
	opacity: 0.5;
}

.diffSection {
	margin-top: 16px;
	padding-top: 16px;
	border-top: 1px solid var(--MI_THEME-divider);
}

.diffLabel {
	font-weight: bold;
	margin-bottom: 12px;
	display: flex;
	align-items: center;
	gap: 8px;
}

.diffContent {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.change {
	padding: 8px;
	background: var(--MI_THEME-panel);
	border-radius: 4px;
}

.changeField {
	font-weight: bold;
	margin-bottom: 8px;
	font-size: 0.9em;
}

.changeValues {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.changeOld {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	color: var(--MI_THEME-error);
	opacity: 0.8;

	i {
		flex-shrink: 0;
		margin-top: 2px;
	}
}

.changeNew {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	color: var(--MI_THEME-success);

	i {
		flex-shrink: 0;
		margin-top: 2px;
	}
}
</style>
