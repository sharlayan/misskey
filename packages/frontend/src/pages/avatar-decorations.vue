<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 900px;">
		<div v-if="tab === 'local'" class="_gaps">
			<MkFoldableSection v-for="category in Object.keys(groupedDecorations)" :key="category" :expanded="true">
				<template #header>{{ category || i18n.ts.other }}</template>
				<div :class="$style.decorations">
					<button
						v-for="avatarDecoration in groupedDecorations[category]"
						:key="avatarDecoration.id"
						v-panel
						class="_button"
						:class="$style.decoration"
						@click="edit(avatarDecoration)"
					>
						<div :class="$style.decorationName"><MkCondensedLine :minScale="0.5">{{ avatarDecoration.name }}</MkCondensedLine></div>
						<MkAvatar style="width: 60px; height: 60px;" :user="$i" :decorations="[{ url: avatarDecoration.url }]" forceShowDecoration/>
					</button>
				</div>
			</MkFoldableSection>
		</div>
		<MkPagination v-else :paginator="remotePaginator">
			<template #empty><MkResult type="empty" :text="i18n.ts.none"/></template>
			<template #default="{ items }">
				<div :class="$style.decorations">
					<button
						v-for="decoration in items"
						:key="decoration.id"
						v-panel
						class="_button"
						:class="$style.decoration"
						:disabled="decoration.isImported"
						@click="showRemoteDecoration(decoration)"
					>
						<div :class="$style.decorationName"><MkCondensedLine :minScale="0.5">{{ decoration.name }}</MkCondensedLine></div>
						<MkAvatar style="width: 60px; height: 60px;" :user="$i" :decorations="[{ url: decoration.url }]" forceShowDecoration/>
						<div :class="$style.decorationHost">
							<i v-if="decoration.isImported" class="ti ti-check"></i>
							{{ decoration.host }}
						</div>
					</button>
				</div>
			</template>
		</MkPagination>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref } from 'vue';
import * as Misskey from 'misskey-js';
import { ensureSignin } from '@/i.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import MkFoldableSection from '@/components/MkFoldableSection.vue';
import MkPagination from '@/components/MkPagination.vue';
import { groupAvatarDecorations } from '@/utility/group-avatar-decorations.js';
import { Paginator } from '@/utility/paginator.js';

const $i = ensureSignin();

const tab = ref<'local' | 'remote'>('local');
const avatarDecorations = ref<Misskey.entities.AdminAvatarDecorationsListResponse>([]);
const groupedDecorations = computed(() => groupAvatarDecorations(avatarDecorations.value));
const remotePaginator = markRaw(new Paginator('admin/avatar-decorations/list-remote', {
	limit: 30,
}));

function load() {
	misskeyApi('admin/avatar-decorations/list').then(_avatarDecorations => {
		avatarDecorations.value = _avatarDecorations;
	});
}

async function add(ev: PointerEvent) {
	const { dispose } = await os.popupAsyncWithDialog(import('./avatar-decoration-edit-dialog.vue').then(x => x.default), {
		categories: Object.keys(groupedDecorations.value),
	}, {
		done: result => {
			if (result.created) {
				avatarDecorations.value.unshift(result.created);
			}
		},
		closed: () => dispose(),
	});
}

async function edit(avatarDecoration: Misskey.entities.AdminAvatarDecorationsListResponse[number]) {
	const { dispose } = await os.popupAsyncWithDialog(import('./avatar-decoration-edit-dialog.vue').then(x => x.default), {
		avatarDecoration: avatarDecoration,
		categories: Object.keys(groupedDecorations.value),
	}, {
		done: result => {
			if (result.updated) {
				const index = avatarDecorations.value.findIndex(x => x.id === avatarDecoration.id);
				avatarDecorations.value[index] = {
					...avatarDecorations.value[index],
					...result.updated,
				};
			} else if (result.deleted) {
				avatarDecorations.value = avatarDecorations.value.filter(x => x.id !== avatarDecoration.id);
			}
		},
		closed: () => dispose(),
	});
}

async function showRemoteDecoration(decoration: Misskey.entities.AdminAvatarDecorationsListRemoteResponse[number]) {
	const { dispose } = await os.popupAsyncWithDialog(import('./avatar-decoration-remote-dialog.vue').then(x => x.default), {
		decoration,
	}, {
		done: () => {
			load();
			remotePaginator.updateItem(decoration.id, item => ({ ...item, isImported: true }));
		},
		closed: () => dispose(),
	});
}

const headerActions = computed(() => tab.value === 'local' ? [{
	asFullButton: true,
	icon: 'ti ti-plus',
	text: i18n.ts.add,
	handler: add,
}] : []);

const headerTabs = computed(() => [{
	key: 'local',
	title: i18n.ts.local,
}, {
	key: 'remote',
	title: i18n.ts.remote,
}]);

load();

definePage(() => ({
	title: i18n.ts.avatarDecorations,
	icon: 'ti ti-sparkles',
}));
</script>

<style lang="scss" module>
.decorations {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
	grid-gap: 12px;
}

.decoration {
	cursor: pointer;
	padding: 16px 16px 28px 16px;
	border-radius: 8px;
	text-align: center;
	font-size: 90%;
	overflow: clip;
	contain: content;
}

.decoration:disabled {
	cursor: default;
	opacity: 0.65;
}

.decorationName {
	position: relative;
	z-index: 10;
	font-weight: bold;
	margin-bottom: 20px;
}

.decorationHost {
	margin-top: 12px;
	overflow: hidden;
	color: var(--MI_THEME-fgTransparentWeak);
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
