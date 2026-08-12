/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import * as Redis from 'ioredis';
import { IsNull } from 'typeorm';
import type { AvatarDecorationsRepository, InstancesRepository, UsersRepository, MiAvatarDecoration, MiUser } from '@/models/_.js';
import type Logger from '@/logger.js';
import { IdService } from '@/core/IdService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { MemorySingleCache } from '@/misc/cache.js';
import type { GlobalEvents } from '@/core/GlobalEventService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { appendQuery, query } from '@/misc/prelude/url.js';
import type { Config } from '@/config.js';

type RemoteAvatarDecoration = {
	id: string;
	name: string;
	description: string;
	url: string;
	category: string | null;
};

type RemoteUserAvatarDecoration = {
	id: string;
	angle?: number;
	flipH?: boolean;
	offsetX?: number;
	offsetY?: number;
};

const MAX_USER_AVATAR_DECORATIONS = 16;
const MAX_REMOTE_DECORATION_CATALOG_ITEMS = 4096;

function isValidString(value: unknown, minLength: number, maxLength: number): value is string {
	return typeof value === 'string' && value.length >= minLength && value.length <= maxLength;
}

function isValidHttpUrl(value: unknown): value is string {
	if (!isValidString(value, 1, 768)) return false;
	try {
		return ['http:', 'https:'].includes(new URL(value).protocol);
	} catch {
		return false;
	}
}

function optionalNumber(value: unknown, minimum: number, maximum: number): number | undefined | null {
	if (value == null) return undefined;
	return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function parseRemoteAvatarDecorations(value: unknown): RemoteAvatarDecoration[] | null {
	if (!Array.isArray(value) || value.length > MAX_REMOTE_DECORATION_CATALOG_ITEMS) return null;

	const result: RemoteAvatarDecoration[] = [];
	const ids = new Set<string>();
	for (const item of value) {
		if (
			!isRecord(item) ||
			!isValidString(item.id, 1, 32) ||
			!isValidString(item.name, 1, 256) ||
			!isValidString(item.description, 0, 2048) ||
			!isValidHttpUrl(item.url) ||
			!(item.category == null || isValidString(item.category, 0, 128)) ||
			ids.has(item.id)
		) return null;
		ids.add(item.id);
		result.push({
			id: item.id,
			name: item.name,
			description: item.description,
			url: item.url,
			category: item.category ?? null,
		});
	}
	return result;
}

function parseRemoteUserAvatarDecorations(value: unknown): RemoteUserAvatarDecoration[] | null {
	if (!Array.isArray(value) || value.length > MAX_USER_AVATAR_DECORATIONS) return null;

	const result: RemoteUserAvatarDecoration[] = [];
	const ids = new Set<string>();
	for (const item of value) {
		if (!isRecord(item) || !isValidString(item.id, 1, 32) || !isValidHttpUrl(item.url) || ids.has(item.id)) return null;
		const angle = optionalNumber(item.angle, -0.5, 0.5);
		const offsetX = optionalNumber(item.offsetX, -0.25, 0.25);
		const offsetY = optionalNumber(item.offsetY, -0.25, 0.25);
		if (angle === null || offsetX === null || offsetY === null || !(item.flipH == null || typeof item.flipH === 'boolean')) return null;
		ids.add(item.id);
		result.push({
			id: item.id,
			angle,
			flipH: item.flipH ?? undefined,
			offsetX,
			offsetY,
		});
	}
	return result;
}

@Injectable()
export class AvatarDecorationService implements OnApplicationShutdown {
	private logger: Logger;
	public cache: MemorySingleCache<MiAvatarDecoration[]>;
	public cacheWithRemote: MemorySingleCache<MiAvatarDecoration[]>;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redisForSub)
		private redisForSub: Redis.Redis,

		@Inject(DI.avatarDecorationsRepository)
		private avatarDecorationsRepository: AvatarDecorationsRepository,

		@Inject(DI.instancesRepository)
		private instancesRepository: InstancesRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private idService: IdService,
		private moderationLogService: ModerationLogService,
		private globalEventService: GlobalEventService,
		private httpRequestService: HttpRequestService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('avatar-decoration');
		this.cache = new MemorySingleCache<MiAvatarDecoration[]>(1000 * 60 * 30); // 30m
		this.cacheWithRemote = new MemorySingleCache<MiAvatarDecoration[]>(1000 * 60 * 30); // 30m

		this.redisForSub.on('message', this.onMessage);
	}

	@bindThis
	private async onMessage(_: string, data: string): Promise<void> {
		const obj = JSON.parse(data);

		if (obj.channel === 'internal') {
			const { type, body: _ } = obj.message as GlobalEvents['internal']['payload'];
			switch (type) {
				case 'avatarDecorationCreated':
				case 'avatarDecorationUpdated':
				case 'avatarDecorationDeleted': {
					this.cache.delete();
					this.cacheWithRemote.delete();
					break;
				}
				default:
					break;
			}
		}
	}

	@bindThis
	public async create(options: Partial<MiAvatarDecoration>, moderator?: MiUser): Promise<MiAvatarDecoration> {
		const created = await this.avatarDecorationsRepository.insertOne({
			id: this.idService.gen(),
			...options,
		});
		this.cache.delete();
		this.cacheWithRemote.delete();

		this.globalEventService.publishInternalEvent('avatarDecorationCreated', created);

		if (moderator) {
			this.moderationLogService.log(moderator, 'createAvatarDecoration', {
				avatarDecorationId: created.id,
				avatarDecoration: created,
			});
		}

		return created;
	}

	@bindThis
	public async update(id: MiAvatarDecoration['id'], params: Partial<MiAvatarDecoration>, moderator?: MiUser): Promise<void> {
		const avatarDecoration = await this.avatarDecorationsRepository.findOneByOrFail({ id });

		const date = new Date();
		await this.avatarDecorationsRepository.update(avatarDecoration.id, {
			updatedAt: date,
			...params,
		});
		this.cache.delete();
		this.cacheWithRemote.delete();

		const updated = await this.avatarDecorationsRepository.findOneByOrFail({ id: avatarDecoration.id });
		this.globalEventService.publishInternalEvent('avatarDecorationUpdated', updated);

		if (moderator) {
			this.moderationLogService.log(moderator, 'updateAvatarDecoration', {
				avatarDecorationId: avatarDecoration.id,
				before: avatarDecoration,
				after: updated,
			});
		}
	}

	@bindThis
	private getProxiedUrl(url: string, mode?: 'static' | 'avatar'): string {
		return appendQuery(
			`${this.config.mediaProxy}/${mode ?? 'image'}.webp`,
			query({
				url,
				...(mode ? { [mode]: '1' } : {}),
			}),
		);
	}

	@bindThis
	private async requestRemoteJson(url: string, body: object): Promise<unknown | null> {
		try {
			const response = await this.httpRequestService.send(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (!response.ok) return null;
			return await response.json();
		} catch (err) {
			this.logger.warn(`Failed to fetch remote avatar decorations from ${url}: ${err}`);
			return null;
		}
	}

	@bindThis
	private async syncRemoteDecoration(host: string, userDecoration: RemoteUserAvatarDecoration, remoteDecoration: RemoteAvatarDecoration): Promise<MiAvatarDecoration> {
		const proxiedUrl = this.getProxiedUrl(remoteDecoration.url, 'avatar');
		if (proxiedUrl.length > 1024) throw new Error('The proxied avatar decoration URL is too long');
		const params = {
			name: remoteDecoration.name,
			description: remoteDecoration.description,
			url: proxiedUrl,
			rawUrl: remoteDecoration.url,
			category: remoteDecoration.category,
			remoteId: userDecoration.id,
			host,
		};

		let existing = await this.avatarDecorationsRepository.findOneBy({ host, remoteId: userDecoration.id });
		if (existing == null) {
			try {
				return await this.create(params);
			} catch (err) {
				existing = await this.avatarDecorationsRepository.findOneBy({ host, remoteId: userDecoration.id });
				if (existing == null) throw err;
			}
		}

		await this.update(existing.id, params);
		return await this.avatarDecorationsRepository.findOneByOrFail({ id: existing.id });
	}

	@bindThis
	public async remoteUserUpdate(user: MiUser): Promise<void> {
		if (user.host == null) return;

		const instance = await this.instancesRepository.findOneBy({ host: user.host });
		const softwareName = instance?.softwareName?.toLowerCase();
		if (softwareName == null || !['misskey', 'cherrypick', 'sharkey'].includes(softwareName)) return;

		const hostUrl = `https://${user.host}`;
		const userData = await this.requestRemoteJson(`${hostUrl}/api/users/show`, { username: user.username });
		if (!isRecord(userData)) return;

		const userAvatarDecorations = parseRemoteUserAvatarDecorations(userData.avatarDecorations);
		if (userAvatarDecorations == null) return;
		if (userAvatarDecorations.length === 0) {
			await this.usersRepository.update({ id: user.id, isDeleted: false }, { avatarDecorations: [] });
			return;
		}

		const remoteDecorationData = await this.requestRemoteJson(`${hostUrl}/api/get-avatar-decorations`, {});
		const parsedRemoteDecorations = parseRemoteAvatarDecorations(remoteDecorationData);
		if (parsedRemoteDecorations == null) return;
		const remoteDecorations = new Map(parsedRemoteDecorations.map(decoration => [decoration.id, decoration]));
		if (userAvatarDecorations.some(decoration => !remoteDecorations.has(decoration.id))) return;
		const avatarDecorations: MiUser['avatarDecorations'] = [];
		let synchronizationFailed = false;

		for (const userDecoration of userAvatarDecorations) {
			const remoteDecoration = remoteDecorations.get(userDecoration.id);
			if (remoteDecoration == null) continue;
			try {
				const decoration = await this.syncRemoteDecoration(user.host, userDecoration, remoteDecoration);
				avatarDecorations.push({
					id: decoration.id,
					angle: userDecoration.angle ?? 0,
					flipH: userDecoration.flipH ?? false,
					offsetX: userDecoration.offsetX ?? 0,
					offsetY: userDecoration.offsetY ?? 0,
				});
			} catch (err) {
				this.logger.warn(`Failed to synchronize avatar decoration ${userDecoration.id} from ${user.host}: ${err}`);
				synchronizationFailed = true;
			}
		}

		if (synchronizationFailed) return;
		await this.usersRepository.update({ id: user.id, isDeleted: false }, { avatarDecorations });
	}

	@bindThis
	public async delete(id: MiAvatarDecoration['id'], moderator?: MiUser): Promise<void> {
		const avatarDecoration = await this.avatarDecorationsRepository.findOneByOrFail({ id });

		await this.avatarDecorationsRepository.delete({ id: avatarDecoration.id });
		this.cache.delete();
		this.cacheWithRemote.delete();
		this.globalEventService.publishInternalEvent('avatarDecorationDeleted', avatarDecoration);

		if (moderator) {
			this.moderationLogService.log(moderator, 'deleteAvatarDecoration', {
				avatarDecorationId: avatarDecoration.id,
				avatarDecoration: avatarDecoration,
			});
		}
	}

	@bindThis
	public async getAll(noCache = false, withRemote = false): Promise<MiAvatarDecoration[]> {
		if (noCache) {
			this.cache.delete();
			this.cacheWithRemote.delete();
		}
		return withRemote
			? this.cacheWithRemote.fetch(() => this.avatarDecorationsRepository.find())
			: this.cache.fetch(() => this.avatarDecorationsRepository.find({ where: { host: IsNull() } }));
	}

	@bindThis
	public async getRawUrl(decoration: MiAvatarDecoration): Promise<string | null> {
		if (decoration.host == null) return decoration.rawUrl;
		if (decoration.remoteId == null) return null;

		const remoteData = await this.requestRemoteJson(`https://${decoration.host}/api/get-avatar-decorations`, {});
		const remoteDecorations = parseRemoteAvatarDecorations(remoteData);
		if (remoteDecorations == null) return null;
		const remoteDecoration = remoteDecorations.find(item => item.id === decoration.remoteId);
		if (remoteDecoration == null) return null;

		const proxiedUrl = this.getProxiedUrl(remoteDecoration.url, 'avatar');
		if (proxiedUrl.length > 1024) return null;
		if (
			decoration.name !== remoteDecoration.name ||
			decoration.description !== remoteDecoration.description ||
			decoration.url !== proxiedUrl ||
			decoration.rawUrl !== remoteDecoration.url ||
			decoration.category !== remoteDecoration.category
		) {
			await this.update(decoration.id, {
				name: remoteDecoration.name,
				description: remoteDecoration.description,
				url: proxiedUrl,
				rawUrl: remoteDecoration.url,
				category: remoteDecoration.category,
			});
		}
		return remoteDecoration.url;
	}

	@bindThis
	public async isRemoteDecorationImported(rawUrl: string): Promise<boolean> {
		return await this.avatarDecorationsRepository.exists({
			where: { host: IsNull(), rawUrl },
		});
	}

	@bindThis
	public dispose(): void {
		this.redisForSub.off('message', this.onMessage);
	}

	@bindThis
	public onApplicationShutdown(signal?: string | undefined): void {
		this.dispose();
	}
}
