/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { AvatarDecorationsRepository } from '@/models/_.js';
import { QueryService } from '@/core/QueryService.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requiredRolePolicy: 'canManageAvatarDecorations',
	kind: 'read:admin:avatar-decorations',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				id: { type: 'string', optional: false, nullable: false, format: 'id' },
				createdAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
				updatedAt: { type: 'string', optional: false, nullable: true, format: 'date-time' },
				name: { type: 'string', optional: false, nullable: false },
				description: { type: 'string', optional: false, nullable: false },
				url: { type: 'string', optional: false, nullable: false },
				host: { type: 'string', optional: false, nullable: false },
				remoteId: { type: 'string', optional: false, nullable: false },
				category: { type: 'string', optional: false, nullable: true },
				isImported: { type: 'boolean', optional: false, nullable: false },
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.avatarDecorationsRepository)
		private avatarDecorationsRepository: AvatarDecorationsRepository,

		private queryService: QueryService,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps) => {
			const decorations = await this.queryService
				.makePaginationQuery(this.avatarDecorationsRepository.createQueryBuilder('decoration'), ps.sinceId, ps.untilId)
				.andWhere('decoration.host IS NOT NULL')
				.andWhere('decoration.remoteId IS NOT NULL')
				.limit(ps.limit)
				.getMany();
			const rawUrls = decorations.flatMap(decoration => decoration.rawUrl == null ? [] : [decoration.rawUrl]);
			const importedRows = rawUrls.length === 0 ? [] : await this.avatarDecorationsRepository
				.createQueryBuilder('decoration')
				.select('decoration.rawUrl', 'rawUrl')
				.where('decoration.host IS NULL')
				.andWhere('decoration.rawUrl IN (:...rawUrls)', { rawUrls })
				.getRawMany<{ rawUrl: string }>();
			const importedRawUrls = new Set(importedRows.map(row => row.rawUrl));

			return decorations.flatMap(decoration => {
				if (decoration.host == null || decoration.remoteId == null) return [];
				return [{
					id: decoration.id,
					createdAt: this.idService.parse(decoration.id).date.toISOString(),
					updatedAt: decoration.updatedAt?.toISOString() ?? null,
					name: decoration.name,
					description: decoration.description,
					url: decoration.url,
					host: decoration.host,
					remoteId: decoration.remoteId,
					category: decoration.category,
					isImported: decoration.rawUrl != null && importedRawUrls.has(decoration.rawUrl),
				}];
			});
		});
	}
}
