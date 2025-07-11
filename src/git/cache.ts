import { Disposable } from 'vscode';
import type { Container } from '../container';
import { configuration } from '../system/-webview/configuration';
import { log } from '../system/decorators/log';
import type { PromiseOrValue } from '../system/promise';
import type { PromiseCache } from '../system/promiseCache';
import { PathTrie } from '../system/trie';
import type { CachedGitTypes, GitContributorsResult, GitDir, PagedResult } from './gitProvider';
import type { GitBranch } from './models/branch';
import type { GitContributor } from './models/contributor';
import type { GitPausedOperationStatus } from './models/pausedOperationStatus';
import type { GitRemote } from './models/remote';
import type { GitStash } from './models/stash';
import type { GitTag } from './models/tag';
import type { GitUser } from './models/user';
import type { GitWorktree } from './models/worktree';
import type { RemoteProvider } from './remotes/remoteProvider';

type RepoPath = string;

interface RepositoryInfo {
	gitDir?: GitDir;
	user?: GitUser | null;
}

const emptyArray: readonly any[] = Object.freeze([]);

export class GitCache implements Disposable {
	private readonly _disposable: Disposable;

	constructor(private readonly container: Container) {
		this._useCaching = configuration.get('advanced.caching.enabled');
		this._disposable = Disposable.from(
			configuration.onDidChange(e => {
				if (configuration.changed(e, 'advanced.caching.enabled')) {
					this._useCaching = configuration.get('advanced.caching.enabled');
					if (!this._useCaching) {
						this.reset(true);
					}
				}

				if (configuration.changed(e, 'remotes')) {
					this.clearCaches(undefined, 'remotes');
				}
			}),
			container.events.on('git:cache:reset', e =>
				this.clearCaches(e.data.repoPath, ...(e.data.types ?? emptyArray)),
			),
		);
	}

	dispose(): void {
		this.reset();
		this._disposable.dispose();
	}

	private _useCaching: boolean = false;
	get useCaching(): boolean {
		return this._useCaching;
	}

	private _bestRemotesCache: Map<RepoPath, Promise<GitRemote<RemoteProvider>[]>> | undefined;
	get bestRemotes(): Map<RepoPath, Promise<GitRemote<RemoteProvider>[]>> {
		return (this._bestRemotesCache ??= new Map<RepoPath, Promise<GitRemote<RemoteProvider>[]>>());
	}

	private _branchCache: Map<RepoPath, Promise<GitBranch | undefined>> | undefined;
	get branch(): Map<RepoPath, Promise<GitBranch | undefined>> | undefined {
		return this.useCaching
			? (this._branchCache ??= new Map<RepoPath, Promise<GitBranch | undefined>>())
			: undefined;
	}

	private _branchesCache: Map<RepoPath, Promise<PagedResult<GitBranch>>> | undefined;
	get branches(): Map<RepoPath, Promise<PagedResult<GitBranch>>> | undefined {
		return this.useCaching
			? (this._branchesCache ??= new Map<RepoPath, Promise<PagedResult<GitBranch>>>())
			: undefined;
	}

	private _contributorsCache: Map<RepoPath, PromiseCache<string, GitContributorsResult>> | undefined;
	get contributors(): Map<RepoPath, PromiseCache<string, GitContributorsResult>> | undefined {
		return this.useCaching
			? (this._contributorsCache ??= new Map<RepoPath, PromiseCache<string, GitContributorsResult>>())
			: undefined;
	}

	private _contributorsLiteCache: Map<RepoPath, PromiseCache<string, GitContributor[]>> | undefined;
	get contributorsLite(): Map<RepoPath, PromiseCache<string, GitContributor[]>> | undefined {
		return this.useCaching
			? (this._contributorsLiteCache ??= new Map<RepoPath, PromiseCache<string, GitContributor[]>>())
			: undefined;
	}

	private _defaultBranchNameCache: Map<RepoPath, Map<string, Promise<string | undefined>>> | undefined;
	get defaultBranchName(): Map<RepoPath, Map<string, Promise<string | undefined>>> | undefined {
		return this.useCaching
			? (this._defaultBranchNameCache ??= new Map<RepoPath, Map<string, Promise<string | undefined>>>())
			: undefined;
	}

	private _pausedOperationStatusCache: Map<RepoPath, Promise<GitPausedOperationStatus | undefined>> | undefined;
	get pausedOperationStatus(): Map<RepoPath, Promise<GitPausedOperationStatus | undefined>> | undefined {
		return this.useCaching
			? (this._pausedOperationStatusCache ??= new Map<RepoPath, Promise<GitPausedOperationStatus | undefined>>())
			: undefined;
	}

	private _remotesCache: Map<RepoPath, Promise<GitRemote[]>> | undefined;
	get remotes(): Map<RepoPath, Promise<GitRemote[]>> | undefined {
		return this.useCaching ? (this._remotesCache ??= new Map<RepoPath, Promise<GitRemote[]>>()) : undefined;
	}

	private _repoInfoCache: Map<RepoPath, RepositoryInfo> | undefined;
	get repoInfo(): Map<RepoPath, RepositoryInfo> {
		return (this._repoInfoCache ??= new Map<RepoPath, RepositoryInfo>());
	}

	private _stashesCache: Map<RepoPath, Promise<GitStash>> | undefined;
	get stashes(): Map<RepoPath, Promise<GitStash>> | undefined {
		return this.useCaching ? (this._stashesCache ??= new Map<RepoPath, Promise<GitStash>>()) : undefined;
	}

	private _tagsCache: Map<RepoPath, Promise<PagedResult<GitTag>>> | undefined;
	get tags(): Map<RepoPath, Promise<PagedResult<GitTag>>> | undefined {
		return this.useCaching ? (this._tagsCache ??= new Map<RepoPath, Promise<PagedResult<GitTag>>>()) : undefined;
	}

	private _trackedPaths = new PathTrie<PromiseOrValue<[string, string] | undefined>>();
	get trackedPaths(): PathTrie<PromiseOrValue<[string, string] | undefined>> {
		return this._trackedPaths;
	}

	private _worktreesCache: Map<RepoPath, Promise<GitWorktree[]>> | undefined;
	get worktrees(): Map<RepoPath, Promise<GitWorktree[]>> | undefined {
		return this.useCaching ? (this._worktreesCache ??= new Map<RepoPath, Promise<GitWorktree[]>>()) : undefined;
	}

	@log({ singleLine: true })
	clearCaches(repoPath: string | undefined, ...types: CachedGitTypes[]): void {
		const cachesToClear = new Set<Map<string, unknown> | PathTrie<unknown> | undefined>();

		if (!types.length || types.includes('branches')) {
			cachesToClear.add(this._branchCache);
			cachesToClear.add(this._branchesCache);
			cachesToClear.add(this._defaultBranchNameCache);
		}

		if (!types.length || types.includes('contributors')) {
			cachesToClear.add(this._contributorsCache);
			cachesToClear.add(this._contributorsLiteCache);
		}

		if (!types.length || types.includes('remotes')) {
			cachesToClear.add(this._remotesCache);
			cachesToClear.add(this._bestRemotesCache);
			cachesToClear.add(this._defaultBranchNameCache);
		}

		if (!types.length || types.includes('providers')) {
			cachesToClear.add(this._bestRemotesCache);
		}

		if (!types.length || types.includes('stashes')) {
			cachesToClear.add(this._stashesCache);
		}

		if (!types.length || types.includes('status')) {
			cachesToClear.add(this._pausedOperationStatusCache);
		}

		if (!types.length || types.includes('tags')) {
			cachesToClear.add(this._tagsCache);
		}

		if (!types.length || types.includes('worktrees')) {
			cachesToClear.add(this._worktreesCache);
		}

		if (!types.length) {
			cachesToClear.add(this._repoInfoCache);
			cachesToClear.add(this._trackedPaths);
		}

		for (const cache of cachesToClear) {
			if (repoPath != null) {
				cache?.delete(repoPath);
			} else {
				cache?.clear();
			}
		}
	}

	@log({ singleLine: true })
	reset(onlyConfigControlledCaches: boolean = false): void {
		this._branchCache?.clear();
		this._branchCache = undefined;
		this._branchesCache?.clear();
		this._branchesCache = undefined;
		this._contributorsCache?.clear();
		this._contributorsCache = undefined;
		this._contributorsLiteCache?.clear();
		this._contributorsLiteCache = undefined;
		this._pausedOperationStatusCache?.clear();
		this._pausedOperationStatusCache = undefined;
		this._remotesCache?.clear();
		this._remotesCache = undefined;
		this._stashesCache?.clear();
		this._stashesCache = undefined;
		this._tagsCache?.clear();
		this._tagsCache = undefined;
		this._worktreesCache?.clear();
		this._worktreesCache = undefined;

		if (!onlyConfigControlledCaches) {
			this._repoInfoCache?.clear();
			this._repoInfoCache = undefined;

			this._trackedPaths.clear();
		}
	}
}
