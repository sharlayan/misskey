/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class EnableFederatedAvatarDecorations1786502943812 {
	name = 'EnableFederatedAvatarDecorations1786502943812';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" ADD "enableFederatedAvatarDecorations" boolean NOT NULL DEFAULT false`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "enableFederatedAvatarDecorations"`);
	}
}
