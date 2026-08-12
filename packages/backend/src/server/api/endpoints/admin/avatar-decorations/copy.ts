/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Not, IsNull } from 'typeorm';
import ms from 'ms';
import type { AvatarDecorationsRepository } from '@/models/_.js';
import type { MiDriveFile } from '@/models/DriveFile.js';
import { AvatarDecorationService } from '@/core/AvatarDecorationService.js';
import { DriveService } from '@/core/DriveService.js';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requiredRolePolicy: 'canManageAvatarDecorations',
	kind: 'write:admin:avatar-decorations',

	limit: {
		duration: ms('1hour'),
		max: 30,
	},

	errors: {
		noSuchDecoration: {
			message: 'No such remote avatar decoration.',
			code: 'NO_SUCH_AVATAR_DECORATION',
			id: 'd24b09af-a9f0-4446-8cfd-37401d4da745',
		},
		remoteFileUnavailable: {
			message: 'The remote avatar decoration file is unavailable.',
			code: 'REMOTE_AVATAR_DECORATION_FILE_UNAVAILABLE',
			id: '86b89820-3c32-4d5a-9a2e-67263d61e0e6',
		},
		alreadyImported: {
			message: 'The remote avatar decoration has already been imported.',
			code: 'AVATAR_DECORATION_ALREADY_IMPORTED',
			id: '3e9ff311-f09c-47de-8e38-4552ceea3a68',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			id: { type: 'string', optional: false, nullable: false, format: 'id' },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		decorationId: { type: 'string', format: 'misskey:id' },
	},
	required: ['decorationId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.avatarDecorationsRepository)
		private avatarDecorationsRepository: AvatarDecorationsRepository,

		private avatarDecorationService: AvatarDecorationService,
		private driveService: DriveService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const decoration = await this.avatarDecorationsRepository.findOneBy({
				id: ps.decorationId,
				host: Not(IsNull()),
			});
			if (decoration == null) throw new ApiError(meta.errors.noSuchDecoration);

			const sourceUrl = await this.avatarDecorationService.getRawUrl(decoration);
			if (sourceUrl == null) throw new ApiError(meta.errors.remoteFileUnavailable);
			const refreshedDecoration = await this.avatarDecorationsRepository.findOneByOrFail({ id: decoration.id });
			if (await this.avatarDecorationService.isRemoteDecorationImported(sourceUrl)) {
				throw new ApiError(meta.errors.alreadyImported);
			}

			let driveFile: MiDriveFile;
			try {
				driveFile = await this.driveService.uploadFromUrl({
					url: sourceUrl,
					user: null,
					force: true,
					isLocalAddressAllowed: false,
					followRedirect: false,
				});
			} catch {
				throw new ApiError(meta.errors.remoteFileUnavailable);
			}

			try {
				const created = await this.avatarDecorationService.create({
					name: refreshedDecoration.name,
					description: refreshedDecoration.description,
					url: driveFile.url,
					rawUrl: sourceUrl,
					category: refreshedDecoration.category,
				}, me);
				return { id: created.id };
			} catch (err) {
				await this.driveService.deleteFile(driveFile);
				if (await this.avatarDecorationService.isRemoteDecorationImported(sourceUrl)) {
					throw new ApiError(meta.errors.alreadyImported);
				}
				throw err;
			}
		});
	}
}
