<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkWindow
	ref="windowEl"
	:initialWidth="400"
	:initialHeight="520"
	:canResize="true"
	@close="windowEl?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ decoration.name }}</template>

	<div :class="$style.root">
		<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px; flex-grow: 1;">
			<div class="_gaps_m">
				<div :class="$style.preview">
					<div :class="$style.previewItem">
						<MkAvatar :class="$style.avatar" :user="$i" :decorations="[{ url: decoration.url }]" forceShowDecoration/>
					</div>
					<div :class="[$style.previewItem, $style.contrast]">
						<MkAvatar :class="$style.avatar" :user="$i" :decorations="[{ url: decoration.url }]" forceShowDecoration/>
					</div>
				</div>
				<MkKeyValue>
					<template #key>{{ i18n.ts.id }}</template>
					<template #value>{{ decoration.remoteId }}</template>
				</MkKeyValue>
				<MkKeyValue>
					<template #key>{{ i18n.ts.host }}</template>
					<template #value>{{ decoration.host }}</template>
				</MkKeyValue>
				<MkKeyValue v-if="decoration.category">
					<template #key>{{ i18n.ts.category }}</template>
					<template #value>{{ decoration.category }}</template>
				</MkKeyValue>
				<MkKeyValue>
					<template #key>{{ i18n.ts.description }}</template>
					<template #value>{{ decoration.description || i18n.ts.none }}</template>
				</MkKeyValue>
			</div>
		</div>
		<div :class="$style.footer">
			<MkButton primary rounded :disabled="importing || decoration.isImported" @click="importDecoration">
				<i class="ti ti-download"></i> {{ i18n.ts.import }}
			</MkButton>
		</div>
	</div>
</MkWindow>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import MkWindow from '@/components/MkWindow.vue';
import { ensureSignin } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';

const $i = ensureSignin();

const props = defineProps<{
	decoration: Misskey.entities.AdminAvatarDecorationsListRemoteResponse[number];
}>();

const emit = defineEmits<{
	(ev: 'done', id: string): void;
	(ev: 'closed'): void;
}>();

const windowEl = useTemplateRef('windowEl');
const importing = ref(false);

async function importDecoration() {
	if (importing.value || props.decoration.isImported) return;
	importing.value = true;
	try {
		const created = await os.apiWithDialog('admin/avatar-decorations/copy', {
			decorationId: props.decoration.id,
		});
		emit('done', created.id);
		windowEl.value?.close();
	} finally {
		importing.value = false;
	}
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	min-height: 100%;
}

.preview {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--MI-margin);
}

.previewItem {
	display: grid;
	place-items: center;
	min-height: 160px;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
}

.contrast {
	background: var(--MI_THEME-fg);
}

.avatar {
	width: 60px;
	height: 60px;
}

.footer {
	position: sticky;
	bottom: 0;
	display: flex;
	justify-content: center;
	padding: 12px;
	border-top: solid 0.5px var(--MI_THEME-divider);
	background: color(from var(--MI_THEME-bg) srgb r g b / 0.5);
	-webkit-backdrop-filter: var(--MI-blur, blur(15px));
	backdrop-filter: var(--MI-blur, blur(15px));
}
</style>
