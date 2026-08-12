/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mocked } from 'vitest';
import type { MiAvatarDecoration, MiUser } from '@/models/_.js';
import { AvatarDecorationService } from '@/core/AvatarDecorationService.js';

function jsonResponse(value: unknown) {
	return {
		ok: true,
		json: vi.fn().mockResolvedValue(value),
	};
}

describe('AvatarDecorationService', () => {
	let service: AvatarDecorationService;
	let avatarDecorationsRepository: {
		findOneBy: ReturnType<typeof vi.fn>;
		findOneByOrFail: ReturnType<typeof vi.fn>;
		insertOne: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
		exists: ReturnType<typeof vi.fn>;
		find: ReturnType<typeof vi.fn>;
	};
	let usersRepository: { update: ReturnType<typeof vi.fn> };
	let httpRequestService: { send: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		avatarDecorationsRepository = {
			findOneBy: vi.fn(),
			findOneByOrFail: vi.fn(),
			insertOne: vi.fn(),
			update: vi.fn(),
			exists: vi.fn(),
			find: vi.fn(),
		};
		usersRepository = { update: vi.fn() };
		httpRequestService = { send: vi.fn() };

		service = new AvatarDecorationService(
			{ mediaProxy: 'https://media.example.com' } as never,
			{ enableFederatedAvatarDecorations: true } as never,
			{ on: vi.fn(), off: vi.fn() } as never,
			avatarDecorationsRepository as never,
			{ findOneBy: vi.fn().mockResolvedValue({ host: 'remote.example', softwareName: 'misskey' }) } as never,
			usersRepository as never,
			{ gen: vi.fn().mockReturnValue('local-decoration-id') } as never,
			{ log: vi.fn() } as never,
			{ publishInternalEvent: vi.fn() } as never,
			httpRequestService as never,
			{ getLogger: vi.fn().mockReturnValue({ warn: vi.fn() }) } as never,
		);
	});

	test('does not erase decorations when the remote user API is unavailable', async () => {
		httpRequestService.send.mockRejectedValue(new Error('network error'));

		await service.remoteUserUpdate({ id: 'user-id', host: 'remote.example', username: 'alice' } as MiUser);

		expect(usersRepository.update).not.toHaveBeenCalled();
	});

	test('does not fetch remote decorations when federation import is disabled', async () => {
		(service as unknown as { meta: { enableFederatedAvatarDecorations: boolean } }).meta.enableFederatedAvatarDecorations = false;

		await service.remoteUserUpdate({ id: 'user-id', host: 'remote.example', username: 'alice' } as MiUser);

		expect(httpRequestService.send).not.toHaveBeenCalled();
		expect(usersRepository.update).not.toHaveBeenCalled();
	});

	test('clears decorations when the remote response explicitly contains an empty list', async () => {
		httpRequestService.send.mockResolvedValueOnce(jsonResponse({ avatarDecorations: [] }));

		await service.remoteUserUpdate({ id: 'user-id', host: 'remote.example', username: 'alice' } as MiUser);

		expect(usersRepository.update).toHaveBeenCalledWith(
			{ id: 'user-id', isDeleted: false },
			{ avatarDecorations: [] },
		);
	});

	test('preserves decorations when the remote user decoration list is malformed', async () => {
		httpRequestService.send.mockResolvedValueOnce(jsonResponse({
			avatarDecorations: [{ id: 'valid-id', url: 'https://remote.example/valid.webp' }, { id: 1 }],
		}));

		await service.remoteUserUpdate({ id: 'user-id', host: 'remote.example', username: 'alice' } as MiUser);

		expect(usersRepository.update).not.toHaveBeenCalled();
	});

	test('preserves decorations when the canonical decoration list is unavailable', async () => {
		httpRequestService.send
			.mockResolvedValueOnce(jsonResponse({
				avatarDecorations: [{ id: 'remote-decoration-id', url: 'https://remote.example/user-value.webp' }],
			}))
			.mockRejectedValueOnce(new Error('network error'));

		await service.remoteUserUpdate({ id: 'user-id', host: 'remote.example', username: 'alice' } as MiUser);

		expect(avatarDecorationsRepository.update).not.toHaveBeenCalled();
		expect(usersRepository.update).not.toHaveBeenCalled();
	});

	test('preserves all assignments when the canonical list omits one user decoration', async () => {
		httpRequestService.send
			.mockResolvedValueOnce(jsonResponse({
				avatarDecorations: [
					{ id: 'first-decoration', url: 'https://remote.example/first.webp' },
					{ id: 'missing-decoration', url: 'https://remote.example/missing.webp' },
				],
			}))
			.mockResolvedValueOnce(jsonResponse([{
				id: 'first-decoration',
				name: 'First decoration',
				description: '',
				url: 'https://remote.example/first.webp',
				category: null,
			}]));

		await service.remoteUserUpdate({ id: 'user-id', host: 'remote.example', username: 'alice' } as MiUser);

		expect(avatarDecorationsRepository.update).not.toHaveBeenCalled();
		expect(usersRepository.update).not.toHaveBeenCalled();
	});

	test('updates a cached remote decoration and assigns its local id to the user', async () => {
		const existingDecoration = {
			id: 'local-decoration-id',
			host: 'remote.example',
			remoteId: 'remote-decoration-id',
		} as MiAvatarDecoration;
		const updatedDecoration = {
			...existingDecoration,
			url: 'https://media.example.com/avatar.webp',
		} as MiAvatarDecoration;

		httpRequestService.send
			.mockResolvedValueOnce(jsonResponse({
				avatarDecorations: [{
					id: 'remote-decoration-id',
					url: 'https://remote.example/untrusted-user-value.webp',
					angle: 0.25,
				}],
			}))
			.mockResolvedValueOnce(jsonResponse([{
				id: 'remote-decoration-id',
				name: 'Remote decoration',
				description: 'Description',
				url: 'https://remote.example/decoration.webp',
				category: 'Remote',
			}]));
		avatarDecorationsRepository.findOneBy.mockResolvedValue(existingDecoration);
		avatarDecorationsRepository.findOneByOrFail.mockResolvedValue(updatedDecoration);

		await service.remoteUserUpdate({ id: 'user-id', host: 'remote.example', username: 'alice' } as MiUser);

		expect(avatarDecorationsRepository.update).toHaveBeenCalledWith('local-decoration-id', expect.objectContaining({
			name: 'Remote decoration',
			rawUrl: 'https://remote.example/decoration.webp',
			remoteId: 'remote-decoration-id',
			host: 'remote.example',
		}));
		expect(usersRepository.update).toHaveBeenCalledWith(
			{ id: 'user-id', isDeleted: false },
			{ avatarDecorations: [{
				id: 'local-decoration-id',
				angle: 0.25,
				flipH: false,
				offsetX: 0,
				offsetY: 0,
			}] },
		);
	});
});
