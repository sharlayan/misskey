/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';

@Entity('avatar_decoration')
@Index('IDX_avatar_decoration_host_remote_id', ['host', 'remoteId'], {
	unique: true,
	where: '"host" IS NOT NULL AND "remoteId" IS NOT NULL',
})
@Index('IDX_avatar_decoration_local_raw_url', ['rawUrl'], {
	unique: true,
	where: '"host" IS NULL AND "rawUrl" IS NOT NULL',
})
export class MiAvatarDecoration {
	@PrimaryColumn(id())
	public id: string;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public updatedAt: Date | null;

	@Column('varchar', {
		length: 1024,
	})
	public url: string;

	@Column('varchar', {
		length: 256,
	})
	public name: string;

	@Column('varchar', {
		length: 2048,
	})
	public description: string;

	// TODO: 定期ジョブで存在しなくなったロールIDを除去するようにする
	@Column('varchar', {
		array: true, length: 128, default: '{}',
	})
	public roleIdsThatCanBeUsedThisDecoration: string[];

	@Column('varchar', {
		length: 128, nullable: true,
	})
	public category: string | null;

	@Column('varchar', {
		length: 32, nullable: true,
	})
	public remoteId: string | null;

	@Column('varchar', {
		length: 128, nullable: true,
	})
	public host: string | null;

	@Column('text', {
		nullable: true,
	})
	public rawUrl: string | null;
}
