/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AvatarDecorationRemoteImport1786500121411 {
	name = 'AvatarDecorationRemoteImport1786500121411';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "avatar_decoration" ADD "rawUrl" text`);
		await queryRunner.query(`
			WITH ranked AS (
				SELECT
					"id",
					FIRST_VALUE("id") OVER (PARTITION BY "host", "remoteId" ORDER BY "id") AS "retainedId",
					ROW_NUMBER() OVER (PARTITION BY "host", "remoteId" ORDER BY "id") AS "position"
				FROM "avatar_decoration"
				WHERE "host" IS NOT NULL AND "remoteId" IS NOT NULL
			), duplicates AS (
				SELECT "id" AS "duplicateId", "retainedId"
				FROM ranked
				WHERE "position" > 1
			), rewritten AS (
				SELECT
					"user"."id" AS "userId",
					jsonb_agg(
						CASE
							WHEN duplicates."retainedId" IS NULL THEN item.value
							ELSE jsonb_set(item.value, '{id}', to_jsonb(duplicates."retainedId"))
						END
						ORDER BY item.ordinality
					) AS "avatarDecorations"
				FROM "user"
				CROSS JOIN LATERAL jsonb_array_elements("user"."avatarDecorations") WITH ORDINALITY AS item(value, ordinality)
				LEFT JOIN duplicates ON item.value->>'id' = duplicates."duplicateId"
				GROUP BY "user"."id"
				HAVING COUNT(duplicates."duplicateId") > 0
			)
			UPDATE "user" AS "user"
			SET "avatarDecorations" = rewritten."avatarDecorations"
			FROM rewritten
			WHERE "user"."id" = rewritten."userId"
		`);
		await queryRunner.query(`
			WITH ranked AS (
				SELECT
					"id",
					ROW_NUMBER() OVER (PARTITION BY "host", "remoteId" ORDER BY "id") AS "position"
				FROM "avatar_decoration"
				WHERE "host" IS NOT NULL AND "remoteId" IS NOT NULL
			)
			DELETE FROM "avatar_decoration"
			USING ranked
			WHERE "avatar_decoration"."id" = ranked."id" AND ranked."position" > 1
		`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_avatar_decoration_host_remote_id" ON "avatar_decoration" ("host", "remoteId") WHERE "host" IS NOT NULL AND "remoteId" IS NOT NULL`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_avatar_decoration_local_raw_url" ON "avatar_decoration" ("rawUrl") WHERE "host" IS NULL AND "rawUrl" IS NOT NULL`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "public"."IDX_avatar_decoration_local_raw_url"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_avatar_decoration_host_remote_id"`);
		await queryRunner.query(`ALTER TABLE "avatar_decoration" DROP COLUMN "rawUrl"`);
	}
}
