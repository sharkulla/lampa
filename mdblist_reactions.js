(function() {
    'use strict';

    var CACHE_PREFIX = 'mdblist_v13_';
    var OLD_CACHE_PREFIXES = new Array('mdblist_v7_', 'mdblist_v8_', 'mdblist_v9_', 'mdblist_v10_', 'mdblist_v11_', 'mdblist_v12_');
    var VOTE_PREFIX = 'mdblist_user_vote_';
    var TRAKT_TOKEN_KEY = 'trakt_access_token';
    var TRAKT_REFRESH_KEY = 'trakt_refresh_token';
    var TRAKT_EXPIRES_KEY = 'trakt_token_expires';
    var TRAKT_SYNC_CACHE_MOVIES = 'trakt_sync_ratings_movies_v1';
    var TRAKT_SYNC_CACHE_SHOWS = 'trakt_sync_ratings_shows_v1';
    var TRAKT_WATCHED_CACHE_MOVIES = 'trakt_watched_movies_v1';
    var TRAKT_WATCHED_CACHE_SHOWS = 'trakt_watched_shows_v1';
    var TRAKT_RECS_CACHE_KEY = 'trakt_recs_cache_v1';
    var TRAKT_SYNC_TTL_MS = 15 * 60 * 1000;
    var TRAKT_RECS_TTL_MS = 30 * 60 * 1000;
    var CACHE_TTL_MINUTES = 1440;
    var STYLE_ID = 'mdblist-reactions-plugin-styles';
    var PLUGIN_COMPONENT = 'mdblist_reactions';
    var initialized = false;
    var activePollTimer = null;
    var watchlistSyncLock = false;

    var scrobbleSession = {
        active: false,
        movie: null,
        isShow: false,
        season: 0,
        episode: 0,
        imdbId: '',
        tmdbId: 0,
        progress: 0,
        startedSent: false,
        completedSent: false,
        paused: false,
        lastPauseProgress: -1,
        lastTickTs: 0
    };

    var REACTION_DEFS = new Array(
        {
            key: 'masterpiece',
            emoji: '🔥',
            png: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/1f525.png',
            barColor: 'rgba(255, 94, 20, 0.85)',
            traktScore: 10,
            label: 'Шедевр (5★ Trakt)',
            order: 0
        },
        {
            key: 'worth',
            emoji: '👍',
            png: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/1f44d.png',
            barColor: 'rgba(255, 204, 0, 0.85)',
            traktScore: 8,
            label: 'Варто глянути (4★ Trakt)',
            order: 1
        },
        {
            key: 'once',
            emoji: '🤔',
            png: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/1f914.png',
            barColor: 'rgba(255, 193, 7, 0.78)',
            traktScore: 6,
            label: 'На один раз (3★ Trakt)',
            order: 2
        },
        {
            key: 'boring',
            emoji: '😴',
            png: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/1f634.png',
            barColor: 'rgba(100, 149, 237, 0.85)',
            traktScore: 4,
            label: 'Нудно (2★ Trakt)',
            order: 3
        },
        {
            key: 'weak',
            emoji: '💩',
            png: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/1f4a9.png',
            barColor: 'rgba(181, 115, 65, 0.85)',
            traktScore: 2,
            label: 'Слабко (1★ Trakt)',
            order: 4
        }
    );

    var PLATFORM_ORDER = new Array(
        'imdb',
        'trakt',
        'tmdb',
        'letterboxd',
        'tomatoes',
        'popcorn',
        'metacritic'
    );

    function logDebug() {
        if (window.console && typeof window.console.log === 'function') {
            var args = new Array('[MDBList Plugin]');
            var i;
            for (i = 0; i < arguments.length; i++) {
                args.push(arguments[i]);
            }
            window.console.log.apply(window.console, args);
        }
    }

    function trimStr(str) {
        if (str === undefined || str === null) return '';
        return String(str).replace(/^\s+|\s+$/g, '');
    }

    function getStorageBoolTrueDefault(key) {
        if (!window.Lampa || !Lampa.Storage) return true;
        var val = Lampa.Storage.get(key, true);
        if (val === false || val === 'false' || val === 0 || val === '0') {
            return false;
        }
        return true;
    }

    function getStorageStr(key, defaultVal) {
        if (!window.Lampa || !Lampa.Storage) return defaultVal;
        var val = Lampa.Storage.get(key, defaultVal);
        return (val === undefined || val === null || val === '') ? defaultVal : String(val);
    }

    function getApiKeys() {
        return {
            mdblistKey: trimStr(getStorageStr('mdblist_api_key', '')),
            traktClientId: trimStr(getStorageStr('trakt_client_id', ''))
        };
    }

    function getSettings() {
        return {
            pillStyle: getStorageStr('mdb_pill_style', 'glass'),
            badgeStyle: getStorageStr('mdb_badge_style', 'original'),
            scale: getStorageStr('mdb_scale', '1.0'),
            titleSize: getStorageStr('mdb_title_size', 'default'),
            taglineSize: getStorageStr('mdb_tagline_size', 'compact'),
            buttonsSize: getStorageStr('mdb_buttons_size', 'default'),
            descSize: getStorageStr('mdb_desc_size', 'default'),
            autoScrobble: getStorageBoolTrueDefault('trakt_auto_scrobble'),
            showWatchedBadge: getStorageBoolTrueDefault('trakt_show_watched'),
            syncWatchlist: getStorageBoolTrueDefault('trakt_sync_watchlist'),
            showRecs: getStorageBoolTrueDefault('trakt_show_recs'),
            usePngEmojis: getStorageBoolTrueDefault('mdb_use_png_emojis'),
            emojiGlow: getStorageBoolTrueDefault('mdb_emoji_glow'),
            emojiAnim: getStorageBoolTrueDefault('mdb_emoji_anim'),
            emojiBar: getStorageBoolTrueDefault('mdb_emoji_bar'),
            showPills: getStorageBoolTrueDefault('mdb_show_pills'),
            showImdb: getStorageBoolTrueDefault('mdb_show_imdb'),
            showTrakt: getStorageBoolTrueDefault('mdb_show_trakt'),
            showTmdb: getStorageBoolTrueDefault('mdb_show_tmdb'),
            showLetterboxd: getStorageBoolTrueDefault('mdb_show_letterboxd'),
            showTomatoes: getStorageBoolTrueDefault('mdb_show_tomatoes'),
            showPopcorn: getStorageBoolTrueDefault('mdb_show_popcorn'),
            showMetacritic: getStorageBoolTrueDefault('mdb_show_metacritic')
        };
    }

    function isPlatformEnabled(sourceKey, settings) {
        if (sourceKey === 'imdb') return settings.showImdb;
        if (sourceKey === 'trakt') return settings.showTrakt;
        if (sourceKey === 'tmdb') return settings.showTmdb;
        if (sourceKey === 'letterboxd') return settings.showLetterboxd;
        if (sourceKey === 'tomatoes') return settings.showTomatoes;
        if (sourceKey === 'popcorn') return settings.showPopcorn;
        if (sourceKey === 'metacritic') return settings.showMetacritic;
        return false;
    }

    function readCache(cacheKey) {
        try {
            if (!window.Lampa || !Lampa.Storage) return null;
            var raw = Lampa.Storage.get(cacheKey, null);
            if (!raw || typeof raw !== 'object') {
                return null;
            }
            if (raw._ts && raw.payload && !raw.payload.apiError && !raw.payload.isLoading) {
                var keys = getApiKeys();
                var mdblistOk = !keys.mdblistKey || (raw.payload.ratings && raw.payload.ratings.length > 0);
                var traktOk = !keys.traktClientId || (raw.payload.reactions && raw.payload.reactions.isExact === true);
                if (!mdblistOk || !traktOk) {
                    return null;
                }
                var ageMs = new Date().getTime() - Number(raw._ts);
                if (ageMs >= 0 && ageMs < CACHE_TTL_MINUTES * 60 * 1000) {
                    return raw.payload;
                }
                Lampa.Storage.remove(cacheKey);
                return null;
            }
            return null;
        } catch (err) {
            return null;
        }
    }

    function writeCache(cacheKey, payload) {
        try {
            if (!payload || payload.apiError || payload.isLoading) return;
            var hasRatings = payload.ratings && payload.ratings.length > 0;
            var hasExactReactions = payload.reactions && payload.reactions.isExact === true;
            if (!hasRatings && !hasExactReactions) return;
            if (!window.Lampa || !Lampa.Storage) return;
            var wrapper = {
                _ts: new Date().getTime(),
                payload: payload
            };
            Lampa.Storage.set(cacheKey, wrapper);
        } catch (err) {
            /* ignore storage errors */
        }
    }

    function hasPrefixMatch(key) {
        if (!key) return false;
        if (key.indexOf(CACHE_PREFIX) === 0) return true;
        var i;
        for (i = 0; i < OLD_CACHE_PREFIXES.length; i++) {
            if (key.indexOf(OLD_CACHE_PREFIXES[i]) === 0) return true;
        }
        return false;
    }

    function clearTraktSyncCache() {
        if (!window.Lampa || !Lampa.Storage) return;
        try {
            Lampa.Storage.remove(TRAKT_SYNC_CACHE_MOVIES);
            Lampa.Storage.remove(TRAKT_SYNC_CACHE_SHOWS);
        } catch (err) {
            /* ignore */
        }
    }

    function clearTraktWatchedCache() {
        if (!window.Lampa || !Lampa.Storage) return;
        try {
            Lampa.Storage.remove(TRAKT_WATCHED_CACHE_MOVIES);
            Lampa.Storage.remove(TRAKT_WATCHED_CACHE_SHOWS);
        } catch (err) {
            /* ignore */
        }
    }

    function clearTraktRecsCache() {
        if (!window.Lampa || !Lampa.Storage) return;
        try {
            Lampa.Storage.remove(TRAKT_RECS_CACHE_KEY);
        } catch (err) {
            /* ignore */
        }
    }

    function clearPluginCache(silent) {
        var removed = 0;
        try {
            if (window.localStorage) {
                var keysToRemove = new Array();
                var i;
                for (i = 0; i < window.localStorage.length; i++) {
                    var k = window.localStorage.key(i);
                    if (hasPrefixMatch(k)) {
                        keysToRemove.push(k);
                    }
                }
                for (i = 0; i < keysToRemove.length; i++) {
                    window.localStorage.removeItem(keysToRemove[i]);
                    if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.remove === 'function') {
                        Lampa.Storage.remove(keysToRemove[i]);
                    }
                    removed++;
                }
            }
        } catch (err) {
            /* ignore */
        }
        clearTraktSyncCache();
        clearTraktWatchedCache();
        clearTraktRecsCache();
        logDebug('Кеш очищено, видалено записів:', removed);
        if (!silent && window.Lampa && Lampa.Noty) {
            Lampa.Noty.show('Кеш рейтингів очищено');
        }
        return removed;
    }

    function isTraktLoggedIn() {
        return Boolean(trimStr(getStorageStr(TRAKT_TOKEN_KEY, '')));
    }

    function clearTraktTokens() {
        if (!window.Lampa || !Lampa.Storage) return;
        Lampa.Storage.remove(TRAKT_TOKEN_KEY);
        Lampa.Storage.remove(TRAKT_REFRESH_KEY);
        Lampa.Storage.remove(TRAKT_EXPIRES_KEY);
        clearTraktSyncCache();
        clearTraktWatchedCache();
        clearTraktRecsCache();
    }

    function saveTraktTokens(tokenData) {
        if (!window.Lampa || !Lampa.Storage || !tokenData) return;
        var createdMs = tokenData.created_at ? (Number(tokenData.created_at) * 1000) : new Date().getTime();
        var expiresMs = createdMs + ((Number(tokenData.expires_in) || 7776000) * 1000);
        Lampa.Storage.set(TRAKT_TOKEN_KEY, String(tokenData.access_token || ''));
        if (tokenData.refresh_token) {
            Lampa.Storage.set(TRAKT_REFRESH_KEY, String(tokenData.refresh_token));
        }
        Lampa.Storage.set(TRAKT_EXPIRES_KEY, String(expiresMs));
    }

    function updateAuthButtonText() {
        var btnText = isTraktLoggedIn()
            ? 'Вийти з Trakt (Підключено)'
            : 'Увійти в акаунт Trakt (Код активації)';
        try {
            var el = document.querySelector('[data-name="trakt_auth_btn"] .settings-param__name');
            if (el) {
                el.textContent = btnText;
            }
        } catch (err) {
            /* ignore */
        }
    }

    function formatVotePlural(count) {
        var n = Math.abs(Math.round(count));
        var mod100 = n % 100;
        var mod10 = n % 10;
        if (mod100 >= 11 && mod100 <= 19) return 'голосів';
        if (mod10 === 1) return 'голос';
        if (mod10 >= 2 && mod10 <= 4) return 'голоси';
        return 'голосів';
    }

    function formatVotesText(votes) {
        var num = Number(votes);
        if (!num || isNaN(num) || num <= 0) return '';
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M голосів';
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K голосів';
        }
        return Math.round(num) + ' ' + formatVotePlural(num);
    }

    function formatPillCount(count) {
        var n = Math.max(0, Math.round(Number(count) || 0));
        if (n >= 1000000) {
            return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        }
        if (n >= 10000) {
            return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        }
        return String(n);
    }

    function normalizeSourceKey(rawSource) {
        if (!rawSource) return '';
        var s = String(rawSource).toLowerCase();
        if (s === 'tomatoesaudience') return 'popcorn';
        return s;
    }

    function ratingValueToReactionKey(val) {
        var num = Number(val) || 0;
        if (num >= 9) return 'masterpiece';
        if (num >= 7) return 'worth';
        if (num >= 5) return 'once';
        if (num >= 3) return 'boring';
        if (num >= 1) return 'weak';
        return '';
    }

    function reactionKeyToTraktScore(reactionKey) {
        var i;
        for (i = 0; i < REACTION_DEFS.length; i++) {
            if (REACTION_DEFS[i].key === reactionKey) {
                return REACTION_DEFS[i].traktScore;
            }
        }
        return 0;
    }

    function createEmptyReactions(hintText, isPending) {
        return {
            masterpiece: 0,
            worth: 0,
            once: 0,
            boring: 0,
            weak: 0,
            isExact: false,
            isPending: Boolean(isPending),
            hintText: hintText || ''
        };
    }

    function distributionToReactions(dist) {
        if (!dist || typeof dist !== 'object') {
            return createEmptyReactions('Не вдалося отримати розподіл оцінок Trakt', false);
        }
        var r1 = Number(dist['1']) || 0;
        var r2 = Number(dist['2']) || 0;
        var r3 = Number(dist['3']) || 0;
        var r4 = Number(dist['4']) || 0;
        var r5 = Number(dist['5']) || 0;
        var r6 = Number(dist['6']) || 0;
        var r7 = Number(dist['7']) || 0;
        var r8 = Number(dist['8']) || 0;
        var r9 = Number(dist['9']) || 0;
        var r10 = Number(dist['10']) || 0;

        return {
            masterpiece: r9 + r10,
            worth: r7 + r8,
            once: r5 + r6,
            boring: r3 + r4,
            weak: r1 + r2,
            isExact: true,
            isPending: false,
            hintText: ''
        };
    }

    function isTraktSuccessStatus(status) {
        return status === 200 || status === 201 || status === 204;
    }

    function getLampaMovieHash(movie) {
        if (!movie) return '';
        var titleStr = movie.original_title || movie.original_name || movie.title || movie.name || '';
        if (!titleStr) return '';
        if (window.Lampa && Lampa.Utils && typeof Lampa.Utils.hash === 'function') {
            return Lampa.Utils.hash(titleStr);
        }
        return '';
    }

    function syncNativeLampaWatched(movie, isWatched) {
        try {
            if (!window.Lampa || !movie) return;
            var hash = getLampaMovieHash(movie);
            if (hash && Lampa.Timeline && typeof Lampa.Timeline.update === 'function') {
                Lampa.Timeline.update({
                    hash: hash,
                    percent: isWatched ? 100 : 0,
                    time: isWatched ? 1 : 0,
                    duration: isWatched ? 1 : 0
                });
            }
            if (Lampa.Favorite) {
                if (isWatched && typeof Lampa.Favorite.add === 'function') {
                    Lampa.Favorite.add('history', movie, 100);
                } else if (!isWatched && typeof Lampa.Favorite.remove === 'function') {
                    Lampa.Favorite.remove('history', movie);
                }
            }
        } catch (err) {
            /* ignore Lampa native sync errors */
        }
    }

    function xhrTraktRequest(method, url, bodyObj, accessToken, traktClientId, onResult) {
        var xhr = new XMLHttpRequest();
        var settled = false;
        var clientId = trimStr(traktClientId || getStorageStr('trakt_client_id', ''));
        var token = trimStr(accessToken || '');

        var finish = function(status, parsed, rawText) {
            if (settled) return;
            settled = true;
            onResult(status, parsed, rawText);
        };

        xhr.open(method, url, true);
        xhr.timeout = 12000;
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('trakt-api-version', '2');
        xhr.setRequestHeader('trakt-api-key', clientId);
        if (token) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        }

        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4) return;
            var raw = xhr.responseText || '';
            var parsed = null;
            if (raw) {
                try {
                    parsed = JSON.parse(raw);
                } catch (err) {
                    parsed = null;
                }
            }
            finish(xhr.status, parsed, raw);
        };

        xhr.ontimeout = function() {
            finish(0, null, 'Timeout');
        };

        xhr.onerror = function() {
            finish(xhr.status || 0, null, 'Network Error');
        };

        try {
            xhr.send(bodyObj ? JSON.stringify(bodyObj) : null);
        } catch (sendErr) {
            finish(0, null, sendErr && sendErr.message ? sendErr.message : 'Send Error');
        }
    }

    function ensureValidTraktToken(callback) {
        var accessToken = trimStr(getStorageStr(TRAKT_TOKEN_KEY, ''));
        var keys = getApiKeys();
        if (!accessToken || !keys.traktClientId) {
            callback('');
            return;
        }

        var expiresAt = Number(getStorageStr(TRAKT_EXPIRES_KEY, '0')) || 0;
        var now = new Date().getTime();

        if (!expiresAt || now < (expiresAt - 60000)) {
            callback(accessToken);
            return;
        }

        var refreshToken = trimStr(getStorageStr(TRAKT_REFRESH_KEY, ''));
        if (!refreshToken) {
            callback(accessToken);
            return;
        }

        logDebug('Оновлення токена Trakt через refresh_token...');
        xhrTraktRequest('POST', 'https://api.trakt.tv/oauth/token', {
            refresh_token: refreshToken,
            client_id: keys.traktClientId,
            redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
            grant_type: 'refresh_token'
        }, '', keys.traktClientId, function(status, parsed) {
            if (status === 200 && parsed && parsed.access_token) {
                saveTraktTokens(parsed);
                logDebug('Токен Trakt успішно оновлено');
                callback(String(parsed.access_token));
            } else if ((status === 400 || status === 401) && now >= expiresAt) {
                logDebug('Токен оновлення Trakt недійсний, вихід з акаунта');
                clearTraktTokens();
                updateAuthButtonText();
                callback('');
            } else {
                callback(accessToken);
            }
        });
    }

    function stopDevicePolling() {
        if (activePollTimer) {
            window.clearTimeout(activePollTimer);
            activePollTimer = null;
        }
    }

    function startTraktDeviceAuth() {
        var keys = getApiKeys();
        if (!keys.traktClientId) {
            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show('Спочатку введіть Trakt Client ID у полі нижче');
            }
            return;
        }

        stopDevicePolling();

        xhrTraktRequest('POST', 'https://api.trakt.tv/oauth/device/code', {
            client_id: keys.traktClientId
        }, '', keys.traktClientId, function(status, codeData) {
            if (status !== 200 || !codeData || !codeData.device_code || !codeData.user_code) {
                if (window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show('Помилка отримання коду активації Trakt (HTTP ' + status + ')');
                }
                return;
            }

            var verifyUrl = codeData.verification_url || 'https://trakt.tv/activate';
            var userCode = String(codeData.user_code);
            var deviceCode = String(codeData.device_code);
            var pollIntervalMs = (Number(codeData.interval) || 5) * 1000;
            var expiresAtMs = new Date().getTime() + ((Number(codeData.expires_in) || 600) * 1000);
            var modalClosed = false;

            var modalEl = document.createElement('div');
            modalEl.className = 'mdb-trakt-auth-modal';
            modalEl.innerHTML = '' +
                '<div class="mdb-auth-desc">Відкрийте у браузері на телефоні або комп’ютері:</div>' +
                '<div class="mdb-auth-url">' + verifyUrl + '</div>' +
                '<div class="mdb-auth-desc">Та введіть цей код активації:</div>' +
                '<div class="mdb-auth-code">' + userCode + '</div>' +
                '<div class="mdb-auth-status">Очікування підтвердження в Trakt...</div>';

            var statusNode = modalEl.querySelector('.mdb-auth-status');

            var closeAuthModal = function() {
                modalClosed = true;
                stopDevicePolling();
                if (window.Lampa && Lampa.Modal) {
                    Lampa.Modal.close();
                }
                if (window.Lampa && Lampa.Controller) {
                    try {
                        Lampa.Controller.toggle('settings_component');
                    } catch (eCtrl) {
                        /* ignore */
                    }
                }
            };

            if (window.Lampa && Lampa.Modal) {
                Lampa.Modal.open({
                    title: 'Підключення акаунта Trakt',
                    html: window.$ ? window.$(modalEl) : modalEl,
                    size: 'medium',
                    onBack: function() {
                        closeAuthModal();
                    }
                });
            }

            var schedulePoll = function(delayMs) {
                if (modalClosed) return;
                activePollTimer = window.setTimeout(pollToken, delayMs);
            };

            var pollToken = function() {
                if (modalClosed) return;
                if (new Date().getTime() >= expiresAtMs) {
                    if (statusNode) statusNode.textContent = 'Час дії коду вичерпано. Спробуйте ще раз.';
                    window.setTimeout(closeAuthModal, 2000);
                    return;
                }

                xhrTraktRequest('POST', 'https://api.trakt.tv/oauth/device/token', {
                    code: deviceCode,
                    client_id: keys.traktClientId
                }, '', keys.traktClientId, function(tokStatus, tokData) {
                    if (modalClosed) return;

                    if (tokStatus === 200 && tokData && tokData.access_token) {
                        saveTraktTokens(tokData);
                        clearTraktSyncCache();
                        clearTraktWatchedCache();
                        clearTraktRecsCache();
                        updateAuthButtonText();
                        closeAuthModal();
                        if (window.Lampa && Lampa.Noty) {
                            Lampa.Noty.show('Успішно підключено до Trakt!');
                        }
                        if (getSettings().syncWatchlist) {
                            window.setTimeout(function() {
                                runTwoWayWatchlistSync(false);
                            }, 800);
                        }
                        return;
                    }

                    if (tokStatus === 400) {
                        schedulePoll(pollIntervalMs);
                        return;
                    }

                    if (tokStatus === 429) {
                        pollIntervalMs += 2000;
                        schedulePoll(pollIntervalMs);
                        return;
                    }

                    if (tokStatus === 418) {
                        if (statusNode) statusNode.textContent = 'Авторизацію відхилено користувачем.';
                        window.setTimeout(closeAuthModal, 1800);
                        return;
                    }

                    if (tokStatus === 409 || tokStatus === 410 || tokStatus === 404) {
                        if (statusNode) statusNode.textContent = 'Код активації недійсний або протермінований.';
                        window.setTimeout(closeAuthModal, 1800);
                        return;
                    }

                    schedulePoll(pollIntervalMs);
                });
            };

            schedulePoll(pollIntervalMs);
        });
    }

    function readTraktTimedMap(storageKey, customTtlMs) {
        var ttl = customTtlMs || TRAKT_SYNC_TTL_MS;
        try {
            if (!window.Lampa || !Lampa.Storage) return null;
            var raw = Lampa.Storage.get(storageKey, null);
            if (!raw || !raw._ts || !raw.map) return null;
            if ((new Date().getTime() - Number(raw._ts)) < ttl) {
                return raw.map;
            }
            return null;
        } catch (err) {
            return null;
        }
    }

    function writeTraktTimedMap(storageKey, map) {
        try {
            if (!window.Lampa || !Lampa.Storage) return;
            Lampa.Storage.set(storageKey, {
                _ts: new Date().getTime(),
                map: map
            });
        } catch (err) {
            /* ignore */
        }
    }

    function updateLocalTraktSyncMap(isShow, movie, mdbJson, reactionKey) {
        var key = isShow ? TRAKT_SYNC_CACHE_SHOWS : TRAKT_SYNC_CACHE_MOVIES;
        var map = readTraktTimedMap(key);
        if (!map) map = {};

        var score = reactionKey ? reactionKeyToTraktScore(reactionKey) : 0;
        var tmdbKey = 'tmdb_' + movie.id;
        var imdbId = (mdbJson && mdbJson.ids && mdbJson.ids.imdb) || movie.imdb_id || (movie.external_ids && movie.external_ids.imdb_id) || '';
        var traktId = (mdbJson && mdbJson.ids && mdbJson.ids.trakt) ? String(mdbJson.ids.trakt) : '';

        if (score > 0) {
            map[tmdbKey] = score;
            if (imdbId) map['imdb_' + imdbId] = score;
            if (traktId) map['trakt_' + traktId] = score;
        } else {
            delete map[tmdbKey];
            if (imdbId) delete map['imdb_' + imdbId];
            if (traktId) delete map['trakt_' + traktId];
        }

        writeTraktTimedMap(key, map);
    }

    function lookupInIdMap(map, movie, mdbJson) {
        if (!map) return null;
        if (map['tmdb_' + movie.id] !== undefined) return map['tmdb_' + movie.id];
        var traktId = (mdbJson && mdbJson.ids && mdbJson.ids.trakt) ? String(mdbJson.ids.trakt) : '';
        if (traktId && map['trakt_' + traktId] !== undefined) return map['trakt_' + traktId];
        var imdbId = (mdbJson && mdbJson.ids && mdbJson.ids.imdb) || movie.imdb_id || (movie.external_ids && movie.external_ids.imdb_id) || '';
        if (imdbId && map['imdb_' + imdbId] !== undefined) return map['imdb_' + imdbId];
        return null;
    }

    function fetchUserTraktRatingForMedia(movie, mdbJson, callback) {
        var keys = getApiKeys();
        if (!isTraktLoggedIn() || !keys.traktClientId) {
            callback('');
            return;
        }

        var isShow = Boolean(movie.first_air_date);
        var cacheKey = isShow ? TRAKT_SYNC_CACHE_SHOWS : TRAKT_SYNC_CACHE_MOVIES;
        var cachedMap = readTraktTimedMap(cacheKey);
        if (cachedMap) {
            var cachedScore = Number(lookupInIdMap(cachedMap, movie, mdbJson)) || 0;
            callback(ratingValueToReactionKey(cachedScore));
            return;
        }

        ensureValidTraktToken(function(token) {
            if (!token) {
                callback('');
                return;
            }
            var mediaEndpoint = isShow ? 'shows' : 'movies';
            var itemKey = isShow ? 'show' : 'movie';
            var syncUrl = 'https://api.trakt.tv/sync/ratings/' + mediaEndpoint;

            logDebug('Синхронізація особистих оцінок Trakt:', syncUrl);
            xhrTraktRequest('GET', syncUrl, null, token, keys.traktClientId, function(status, list) {
                if (status === 200 && list && typeof list.length === 'number') {
                    var map = {};
                    var i;
                    for (i = 0; i < list.length; i++) {
                        var entry = list[i];
                        var obj = entry ? entry[itemKey] : null;
                        var ids = obj ? obj.ids : null;
                        var ratingVal = Number(entry && entry.rating) || 0;
                        if (ids && ratingVal > 0) {
                            if (ids.tmdb) map['tmdb_' + ids.tmdb] = ratingVal;
                            if (ids.imdb) map['imdb_' + ids.imdb] = ratingVal;
                            if (ids.trakt) map['trakt_' + ids.trakt] = ratingVal;
                        }
                    }
                    writeTraktTimedMap(cacheKey, map);
                    var foundScore = Number(lookupInIdMap(map, movie, mdbJson)) || 0;
                    callback(ratingValueToReactionKey(foundScore));
                } else {
                    callback('');
                }
            });
        });
    }

    function countTotalShowEpisodes(movie, mdbJson) {
        if (movie && Number(movie.number_of_episodes) > 0) {
            return Number(movie.number_of_episodes);
        }
        if (movie && movie.seasons && movie.seasons.length > 0) {
            var sum = 0;
            var i;
            for (i = 0; i < movie.seasons.length; i++) {
                var s = movie.seasons[i];
                if (s && Number(s.season_number) > 0 && Number(s.episode_count) > 0) {
                    sum += Number(s.episode_count);
                }
            }
            if (sum > 0) return sum;
        }
        if (mdbJson && Number(mdbJson.episodes) > 0) {
            return Number(mdbJson.episodes);
        }
        return 0;
    }

    function countWatchedEpisodesInTraktEntry(entry) {
        if (!entry || !entry.seasons || !entry.seasons.length) return 0;
        var countRegular = 0;
        var countAll = 0;
        var i;
        for (i = 0; i < entry.seasons.length; i++) {
            var season = entry.seasons[i];
            if (!season || !season.episodes || !season.episodes.length) continue;
            countAll += season.episodes.length;
            if (Number(season.number) > 0) {
                countRegular += season.episodes.length;
            }
        }
        return countRegular > 0 ? countRegular : countAll;
    }

    function buildWatchedStatusObj(rawVal, movie, mdbJson) {
        var isShow = Boolean(movie.first_air_date);
        if (!isShow) {
            return {
                isShow: false,
                watched: Boolean(rawVal),
                watchedEpisodes: 0,
                totalEpisodes: 0
            };
        }
        var watchedEps = Number(rawVal) || 0;
        var totalEps = countTotalShowEpisodes(movie, mdbJson);
        return {
            isShow: true,
            watched: watchedEps > 0 && (totalEps <= 0 || watchedEps >= totalEps),
            watchedEpisodes: watchedEps,
            totalEpisodes: totalEps
        };
    }

    function fetchUserWatchedStatusForMedia(movie, mdbJson, callback) {
        var keys = getApiKeys();
        if (!isTraktLoggedIn() || !keys.traktClientId) {
            callback(null);
            return;
        }

        var isShow = Boolean(movie.first_air_date);
        var cacheKey = isShow ? TRAKT_WATCHED_CACHE_SHOWS : TRAKT_WATCHED_CACHE_MOVIES;
        var cachedMap = readTraktTimedMap(cacheKey);
        if (cachedMap) {
            var cachedVal = lookupInIdMap(cachedMap, movie, mdbJson);
            var statusObj = buildWatchedStatusObj(cachedVal, movie, mdbJson);
            if (statusObj.watched) {
                syncNativeLampaWatched(movie, true);
            }
            callback(statusObj);
            return;
        }

        ensureValidTraktToken(function(token) {
            if (!token) {
                callback(null);
                return;
            }
            var mediaEndpoint = isShow ? 'shows' : 'movies';
            var itemKey = isShow ? 'show' : 'movie';
            var watchedUrl = 'https://api.trakt.tv/sync/watched/' + mediaEndpoint;

            logDebug('Запит історії переглядів Trakt:', watchedUrl);
            xhrTraktRequest('GET', watchedUrl, null, token, keys.traktClientId, function(status, list) {
                if (status === 200 && list && typeof list.length === 'number') {
                    var map = {};
                    var i;
                    for (i = 0; i < list.length; i++) {
                        var entry = list[i];
                        var obj = entry ? entry[itemKey] : null;
                        var ids = obj ? obj.ids : null;
                        var val = isShow ? countWatchedEpisodesInTraktEntry(entry) : 1;
                        if (ids && val > 0) {
                            if (ids.tmdb) map['tmdb_' + ids.tmdb] = val;
                            if (ids.imdb) map['imdb_' + ids.imdb] = val;
                            if (ids.trakt) map['trakt_' + ids.trakt] = val;
                        }
                    }
                    writeTraktTimedMap(cacheKey, map);
                    var foundVal = lookupInIdMap(map, movie, mdbJson);
                    var resolvedObj = buildWatchedStatusObj(foundVal, movie, mdbJson);
                    if (resolvedObj.watched) {
                        syncNativeLampaWatched(movie, true);
                    }
                    callback(resolvedObj);
                } else {
                    callback(null);
                }
            });
        });
    }

    function updateLocalWatchedMap(isShow, movie, mdbJson, watchedVal) {
        var cacheKey = isShow ? TRAKT_WATCHED_CACHE_SHOWS : TRAKT_WATCHED_CACHE_MOVIES;
        var map = readTraktTimedMap(cacheKey);
        if (!map) map = {};

        var tmdbKey = 'tmdb_' + movie.id;
        var imdbId = (mdbJson && mdbJson.ids && mdbJson.ids.imdb) || movie.imdb_id || (movie.external_ids && movie.external_ids.imdb_id) || '';
        var traktId = (mdbJson && mdbJson.ids && mdbJson.ids.trakt) ? String(mdbJson.ids.trakt) : '';

        if (watchedVal > 0) {
            map[tmdbKey] = watchedVal;
            if (imdbId) map['imdb_' + imdbId] = watchedVal;
            if (traktId) map['trakt_' + traktId] = watchedVal;
        } else {
            delete map[tmdbKey];
            if (imdbId) delete map['imdb_' + imdbId];
            if (traktId) delete map['trakt_' + traktId];
        }

        writeTraktTimedMap(cacheKey, map);
    }

    function hasNotFoundItems(res) {
        if (!res || !res.not_found) return false;
        var nfMovies = res.not_found.movies && res.not_found.movies.length > 0;
        var nfShows = res.not_found.shows && res.not_found.shows.length > 0;
        var nfEpisodes = res.not_found.episodes && res.not_found.episodes.length > 0;
        return Boolean(nfMovies || nfShows || nfEpisodes);
    }

    function toggleWatchedOnTrakt(movie, mdbJson, markAsWatched, onDone) {
        var clientId = trimStr(getStorageStr('trakt_client_id', ''));
        if (!clientId) {
            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show('Помилка Trakt: відсутній Client ID');
            }
            return;
        }

        ensureValidTraktToken(function(token) {
            if (!token) {
                if (window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show('Помилка Trakt: відсутній токен авторизації');
                }
                return;
            }

            var isShow = Boolean(movie.first_air_date);
            var listField = isShow ? 'shows' : 'movies';
            var imdbId = (mdbJson && mdbJson.ids && mdbJson.ids.imdb) || movie.imdb_id || (movie.external_ids && movie.external_ids.imdb_id) || '';
            var tmdbNum = parseInt(movie.id, 10);

            var itemObj = {
                ids: {
                    tmdb: tmdbNum
                }
            };
            if (imdbId) {
                itemObj.ids.imdb = String(imdbId);
            }

            var payload = {};
            payload[listField] = new Array(itemObj);

            var endpoint = markAsWatched
                ? 'https://api.trakt.tv/sync/history'
                : 'https://api.trakt.tv/sync/history/remove';

            logDebug('POST ' + endpoint + ' payload:', JSON.stringify(payload));
            xhrTraktRequest('POST', endpoint, payload, token, clientId, function(status, res, rawText) {
                logDebug('POST ' + endpoint + ' відповідь:', status, rawText);
                var ok = isTraktSuccessStatus(status) && !hasNotFoundItems(res);

                if (ok) {
                    var newVal = markAsWatched
                        ? (isShow ? Math.max(1, countTotalShowEpisodes(movie, mdbJson)) : 1)
                        : 0;
                    clearTraktWatchedCache();
                    updateLocalWatchedMap(isShow, movie, mdbJson, newVal);
                    syncNativeLampaWatched(movie, Boolean(markAsWatched));
                    if (typeof onDone === 'function') onDone(true, newVal);
                    return;
                }

                var errReason = (res && (res.error_description || res.error || res.message))
                    ? (' - ' + (res.error_description || res.error || res.message))
                    : (hasNotFoundItems(res) ? ' (не знайдено)' : '');
                if (window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show('Помилка Trakt: HTTP ' + status + errReason);
                }
                if (typeof onDone === 'function') onDone(false, null);
            });
        });
    }

    function syncReactionToTrakt(movie, mdbJson, reactionKey) {
        var clientId = trimStr(getStorageStr('trakt_client_id', ''));
        if (!clientId) {
            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show('Помилка Trakt: відсутній Client ID');
            }
            return;
        }

        ensureValidTraktToken(function(token) {
            if (!token) {
                if (window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show('Помилка Trakt: відсутній токен авторизації');
                }
                return;
            }

            var isShow = Boolean(movie.first_air_date);
            var listField = isShow ? 'shows' : 'movies';
            var imdbId = (mdbJson && mdbJson.ids && mdbJson.ids.imdb) || movie.imdb_id || (movie.external_ids && movie.external_ids.imdb_id) || '';
            var tmdbNum = parseInt(movie.id, 10);

            var payload = {};
            if (reactionKey) {
                var ratingValue = reactionKeyToTraktScore(reactionKey);
                var itemObj = {
                    rating: ratingValue,
                    ids: {
                        tmdb: tmdbNum
                    }
                };
                if (imdbId) {
                    itemObj.ids.imdb = String(imdbId);
                }
                payload[listField] = new Array(itemObj);

                logDebug('POST /sync/ratings payload:', JSON.stringify(payload));
                xhrTraktRequest('POST', 'https://api.trakt.tv/sync/ratings', payload, token, clientId, function(status, res, rawText) {
                    logDebug('POST /sync/ratings відповідь:', status, rawText);
                    if (isTraktSuccessStatus(status) && !hasNotFoundItems(res)) {
                        updateLocalTraktSyncMap(isShow, movie, mdbJson, reactionKey);
                    } else {
                        var errReason = (res && (res.error_description || res.error || res.message))
                            ? (' - ' + (res.error_description || res.error || res.message))
                            : (hasNotFoundItems(res) ? ' (не знайдено)' : '');
                        if (window.Lampa && Lampa.Noty) {
                            Lampa.Noty.show('Помилка Trakt: HTTP ' + status + errReason);
                        }
                    }
                });
            } else {
                var removeObj = {
                    ids: {
                        tmdb: tmdbNum
                    }
                };
                if (imdbId) {
                    removeObj.ids.imdb = String(imdbId);
                }
                payload[listField] = new Array(removeObj);

                logDebug('POST /sync/ratings/remove payload:', JSON.stringify(payload));
                xhrTraktRequest('POST', 'https://api.trakt.tv/sync/ratings/remove', payload, token, clientId, function(status, res, rawText) {
                    logDebug('POST /sync/ratings/remove відповідь:', status, rawText);
                    if (isTraktSuccessStatus(status) && !hasNotFoundItems(res)) {
                        updateLocalTraktSyncMap(isShow, movie, mdbJson, '');
                    } else {
                        var errReason = (res && (res.error_description || res.error || res.message))
                            ? (' - ' + (res.error_description || res.error || res.message))
                            : (hasNotFoundItems(res) ? ' (не знайдено)' : '');
                        if (window.Lampa && Lampa.Noty) {
                            Lampa.Noty.show('Помилка Trakt: HTTP ' + status + errReason);
                        }
                    }
                });
            }
        });
    }

    function fetchTmdbCardObject(tmdbId, isShow, callback) {
        var typePath = isShow ? 'tv' : 'movie';

        try {
            if (window.Lampa && Lampa.Api && Lampa.Api.sources && Lampa.Api.sources.tmdb && typeof Lampa.Api.sources.tmdb.get === 'function') {
                Lampa.Api.sources.tmdb.get(typePath + '/' + tmdbId, {}, function(card) {
                    if (card && card.id) {
                        if (isShow && !card.first_air_date) {
                            card.first_air_date = card.first_air_date || '';
                        }
                        callback(card);
                    } else {
                        callback(null);
                    }
                }, function() {
                    callback(null);
                });
                return;
            }
        } catch (eApi) {
            /* fallback to Lampa.TMDB */
        }

        try {
            if (window.Lampa && Lampa.TMDB && typeof Lampa.TMDB.api === 'function' && typeof Lampa.TMDB.key === 'function') {
                var lang = getStorageStr('language', 'uk') === 'uk' ? 'uk-UA' : 'en-US';
                var tmdbUrl = Lampa.TMDB.api(typePath + '/' + tmdbId + '?api_key=' + Lampa.TMDB.key() + '&language=' + lang);
                var xhr = new XMLHttpRequest();
                xhr.open('GET', tmdbUrl, true);
                xhr.timeout = 10000;
                xhr.onreadystatechange = function() {
                    if (xhr.readyState !== 4) return;
                    if (xhr.status === 200) {
                        try {
                            var card = JSON.parse(xhr.responseText);
                            callback(card && card.id ? card : null);
                            return;
                        } catch (eParse) {
                            /* ignore */
                        }
                    }
                    callback(null);
                };
                xhr.ontimeout = function() { callback(null); };
                xhr.onerror = function() { callback(null); };
                xhr.send();
                return;
            }
        } catch (eTmdb) {
            /* ignore */
        }

        callback(null);
    }

    function resolveTmdbCardsBatch(items, onComplete) {
        var resolved = new Array();
        var index = 0;

        function next() {
            if (index >= items.length) {
                onComplete(resolved);
                return;
            }
            var current = items[index];
            index++;

            fetchTmdbCardObject(current.tmdbId, current.isShow, function(card) {
                if (card && card.id) {
                    resolved.push(card);
                }
                window.setTimeout(next, 60);
            });
        }

        next();
    }

    function isCardInLampaBookmarks(tmdbId) {
        try {
            if (!window.Lampa || !Lampa.Favorite) return false;
            if (typeof Lampa.Favorite.check === 'function') {
                var chk = Lampa.Favorite.check({ id: Number(tmdbId) });
                if (chk && chk.book) return true;
            }
            if (typeof Lampa.Favorite.get === 'function') {
                var list = Lampa.Favorite.get({ type: 'book' });
                if (list && list.length) {
                    var i;
                    for (i = 0; i < list.length; i++) {
                        if (list[i] && Number(list[i].id) === Number(tmdbId)) {
                            return true;
                        }
                    }
                }
            }
        } catch (err) {
            /* ignore */
        }
        return false;
    }

    function pushBookmarkToTraktWatchlist(card, isAdd) {
        if (!card || !card.id || !isTraktLoggedIn()) return;
        var settings = getSettings();
        if (!settings.syncWatchlist) return;
        var clientId = trimStr(getStorageStr('trakt_client_id', ''));
        if (!clientId) return;

        var isShow = Boolean(card.first_air_date || card.number_of_seasons || card.original_name);
        var field = isShow ? 'shows' : 'movies';
        var itemObj = {
            ids: {
                tmdb: parseInt(card.id, 10)
            }
        };
        if (card.imdb_id) {
            itemObj.ids.imdb = String(card.imdb_id);
        }

        var payload = {};
        payload[field] = new Array(itemObj);

        var url = isAdd
            ? 'https://api.trakt.tv/sync/watchlist'
            : 'https://api.trakt.tv/sync/watchlist/remove';

        ensureValidTraktToken(function(token) {
            if (!token) return;
            logDebug('Watchlist sync ' + (isAdd ? 'ADD' : 'REMOVE') + ':', JSON.stringify(payload));
            xhrTraktRequest('POST', url, payload, token, clientId, function(status, res) {
                if (isTraktSuccessStatus(status)) {
                    logDebug('Watchlist sync успішно:', status);
                } else if (status >= 400 || status === 0) {
                    var errReason = (res && (res.error_description || res.error || res.message)) ? (' - ' + (res.error_description || res.error || res.message)) : '';
                    if (window.Lampa && Lampa.Noty) {
                        Lampa.Noty.show('Помилка Trakt Watchlist: HTTP ' + status + errReason);
                    }
                }
            });
        });
    }

    function runTwoWayWatchlistSync(showSuccessToast) {
        if (!isTraktLoggedIn() || !window.Lampa || !Lampa.Favorite) return;
        var settings = getSettings();
        if (!settings.syncWatchlist && !showSuccessToast) return;
        var clientId = trimStr(getStorageStr('trakt_client_id', ''));
        if (!clientId) return;

        ensureValidTraktToken(function(token) {
            if (!token) return;

            var traktTmdbMap = {};
            var missingInLampa = new Array();

            xhrTraktRequest('GET', 'https://api.trakt.tv/sync/watchlist/movies', null, token, clientId, function(stM, listM) {
                if (stM === 200 && listM && listM.length) {
                    var i;
                    for (i = 0; i < listM.length; i++) {
                        var mObj = listM[i] && listM[i].movie;
                        var mTmdb = mObj && mObj.ids ? parseInt(mObj.ids.tmdb, 10) : 0;
                        if (mTmdb > 0) {
                            traktTmdbMap['m_' + mTmdb] = true;
                            if (!isCardInLampaBookmarks(mTmdb)) {
                                missingInLampa.push({ tmdbId: mTmdb, isShow: false });
                            }
                        }
                    }
                }

                xhrTraktRequest('GET', 'https://api.trakt.tv/sync/watchlist/shows', null, token, clientId, function(stS, listS) {
                    if (stS === 200 && listS && listS.length) {
                        var j;
                        for (j = 0; j < listS.length; j++) {
                            var sObj = listS[j] && listS[j].show;
                            var sTmdb = sObj && sObj.ids ? parseInt(sObj.ids.tmdb, 10) : 0;
                            if (sTmdb > 0) {
                                traktTmdbMap['s_' + sTmdb] = true;
                                if (!isCardInLampaBookmarks(sTmdb)) {
                                    missingInLampa.push({ tmdbId: sTmdb, isShow: true });
                                }
                            }
                        }
                    }

                    if (showSuccessToast && typeof Lampa.Favorite.get === 'function') {
                        var localBooks = Lampa.Favorite.get({ type: 'book' });
                        if (localBooks && localBooks.length) {
                            var pushMovies = new Array();
                            var pushShows = new Array();
                            var bIdx;
                            for (bIdx = 0; bIdx < localBooks.length; bIdx++) {
                                var bCard = localBooks[bIdx];
                                if (!bCard || !bCard.id) continue;
                                var bId = parseInt(bCard.id, 10);
                                if (!bId || isNaN(bId)) continue;
                                var bIsShow = Boolean(bCard.first_air_date || bCard.number_of_seasons || bCard.original_name);
                                var mapKey = (bIsShow ? 's_' : 'm_') + bId;
                                if (!traktTmdbMap[mapKey]) {
                                    if (bIsShow) {
                                        pushShows.push({ ids: { tmdb: bId } });
                                    } else {
                                        pushMovies.push({ ids: { tmdb: bId } });
                                    }
                                }
                            }
                            if (pushMovies.length > 0 || pushShows.length > 0) {
                                var pushPayload = {};
                                if (pushMovies.length > 0) pushPayload.movies = pushMovies;
                                if (pushShows.length > 0) pushPayload.shows = pushShows;
                                xhrTraktRequest('POST', 'https://api.trakt.tv/sync/watchlist', pushPayload, token, clientId, function(pStatus) {
                                    logDebug('Manual Watchlist push status:', pStatus);
                                });
                            }
                        }
                    }

                    resolveTmdbCardsBatch(missingInLampa, function(cards) {
                        var k;
                        for (k = 0; k < cards.length; k++) {
                            if (!isCardInLampaBookmarks(cards[k].id)) {
                                watchlistSyncLock = true;
                                try {
                                    Lampa.Favorite.add('book', cards[k]);
                                } catch (errAdd) {
                                    /* ignore */
                                } finally {
                                    watchlistSyncLock = false;
                                }
                            }
                        }
                        logDebug('Синхронізовано закладок із Trakt Watchlist:', cards.length);
                        if (showSuccessToast && window.Lampa && Lampa.Noty) {
                            Lampa.Noty.show('Watchlist Trakt синхронізовано');
                        }
                    });
                });
            });
        });
    }

    function attachWatchlistListeners() {
        if (!window.Lampa || !Lampa.Favorite || !Lampa.Favorite.listener) return;

        if (typeof Lampa.Favorite.listener.follow === 'function') {
            Lampa.Favorite.listener.follow('add', function(e) {
                if (watchlistSyncLock || !e) return;
                if (e.where !== 'book' && e.type !== 'book') return;
                var card = e.card || e.data || null;
                if (card) pushBookmarkToTraktWatchlist(card, true);
            });

            Lampa.Favorite.listener.follow('remove', function(e) {
                if (watchlistSyncLock || !e) return;
                if (e.where !== 'book' && e.type !== 'book') return;
                var card = e.card || e.data || null;
                if (card) pushBookmarkToTraktWatchlist(card, false);
            });
        }

        window.setTimeout(function() {
            if (isTraktLoggedIn() && getSettings().syncWatchlist) {
                runTwoWayWatchlistSync(false);
            }
        }, 3000);
    }

    function fetchTraktRecommendationsRow(done) {
        var settings = getSettings();
        var keys = getApiKeys();
        if (!settings.showRecs || !isTraktLoggedIn() || !keys.traktClientId) {
            done(new Array());
            return;
        }

        try {
            if (window.Lampa && Lampa.Storage) {
                var cachedRecs = Lampa.Storage.get(TRAKT_RECS_CACHE_KEY, null);
                if (cachedRecs && cachedRecs._ts && cachedRecs.items && cachedRecs.items.length > 0) {
                    if ((new Date().getTime() - Number(cachedRecs._ts)) < TRAKT_RECS_TTL_MS) {
                        done(cachedRecs.items);
                        return;
                    }
                }
            }
        } catch (errCache) {
            /* ignore */
        }

        ensureValidTraktToken(function(token) {
            if (!token) {
                done(new Array());
                return;
            }

            var recSeeds = new Array();

            xhrTraktRequest('GET', 'https://api.trakt.tv/recommendations/movies?limit=15&ignore_collected=true', null, token, keys.traktClientId, function(stM, listM) {
                xhrTraktRequest('GET', 'https://api.trakt.tv/recommendations/shows?limit=15&ignore_collected=true', null, token, keys.traktClientId, function(stS, listS) {
                    var moviesArr = (stM === 200 && listM && listM.length) ? listM : new Array();
                    var showsArr = (stS === 200 && listS && listS.length) ? listS : new Array();
                    var maxLen = Math.max(moviesArr.length, showsArr.length);
                    var i;

                    for (i = 0; i < maxLen && recSeeds.length < 20; i++) {
                        if (i < moviesArr.length && moviesArr[i] && moviesArr[i].ids && moviesArr[i].ids.tmdb) {
                            recSeeds.push({ tmdbId: parseInt(moviesArr[i].ids.tmdb, 10), isShow: false });
                        }
                        if (recSeeds.length < 20 && i < showsArr.length && showsArr[i] && showsArr[i].ids && showsArr[i].ids.tmdb) {
                            recSeeds.push({ tmdbId: parseInt(showsArr[i].ids.tmdb, 10), isShow: true });
                        }
                    }

                    if (recSeeds.length === 0) {
                        done(new Array());
                        return;
                    }

                    resolveTmdbCardsBatch(recSeeds, function(cards) {
                        if (cards.length > 0 && window.Lampa && Lampa.Storage) {
                            try {
                                Lampa.Storage.set(TRAKT_RECS_CACHE_KEY, {
                                    _ts: new Date().getTime(),
                                    items: cards
                                });
                            } catch (eWrite) {
                                /* ignore */
                            }
                        }
                        done(cards);
                    });
                });
            });
        });
    }

    function registerTraktRecommendationsRow() {
        try {
            if (!window.Lampa || !Lampa.ContentRows || typeof Lampa.ContentRows.add !== 'function') return;

            Lampa.ContentRows.add({
                index: 1,
                name: 'trakt_recommendations',
                title: 'Рекомендовано Trakt для вас',
                screen: new Array('main'),
                call: function() {
                    return function(call) {
                        fetchTraktRecommendationsRow(function(items) {
                            call({
                                results: items,
                                title: 'Рекомендовано Trakt для вас'
                            });
                        });
                    };
                }
            });
            logDebug('Полиця «Рекомендовано Trakt для вас» зареєстрована');
        } catch (err) {
            logDebug('ContentRows недоступний у цій версії Lampa:', err && err.message ? err.message : err);
        }
    }

    function buildScrobblePayload(session, progressVal) {
        var idsObj = {
            tmdb: session.tmdbId
        };
        if (session.imdbId) {
            idsObj.imdb = session.imdbId;
        }

        var clampedProgress = Math.min(100, Math.max(0, Math.round(Number(progressVal) || 0)));

        if (session.isShow) {
            return {
                show: { ids: idsObj },
                episode: {
                    season: session.season,
                    number: session.episode
                },
                progress: clampedProgress
            };
        }

        return {
            movie: { ids: idsObj },
            progress: clampedProgress
        };
    }

    function sendTraktScrobble(action, session, progressVal, onSuccess) {
        var settings = getSettings();
        if (!settings.autoScrobble || !isTraktLoggedIn()) return;
        var clientId = trimStr(getStorageStr('trakt_client_id', ''));
        if (!clientId || !session || !session.tmdbId) return;
        if (session.isShow && session.episode <= 0) return;

        var payload = buildScrobblePayload(session, progressVal);
        var url = 'https://api.trakt.tv/scrobble/' + action;

        ensureValidTraktToken(function(token) {
            if (!token) return;
            logDebug('Trakt scrobble/' + action + ':', JSON.stringify(payload));
            xhrTraktRequest('POST', url, payload, token, clientId, function(status, res, rawText) {
                logDebug('Trakt scrobble/' + action + ' відповідь:', status, rawText);
                if (isTraktSuccessStatus(status)) {
                    if (typeof onSuccess === 'function') onSuccess(res);
                } else if (status >= 400 || status === 0) {
                    var errReason = (res && (res.error_description || res.error || res.message)) ? (' - ' + (res.error_description || res.error || res.message)) : '';
                    if (window.Lampa && Lampa.Noty) {
                        Lampa.Noty.show('Помилка Trakt scrobble: HTTP ' + status + errReason);
                    }
                }
            });
        });
    }

    function extractPlayerProgress(evData) {
        if (evData && Number(evData.duration) > 0) {
            return (Number(evData.current) / Number(evData.duration)) * 100;
        }
        try {
            if (window.Lampa && Lampa.PlayerVideo && typeof Lampa.PlayerVideo.video === 'function') {
                var v = Lampa.PlayerVideo.video();
                if (v && Number(v.duration) > 0) {
                    return (Number(v.currentTime) / Number(v.duration)) * 100;
                }
            }
        } catch (err) {
            /* ignore */
        }
        var domVideo = document.querySelector('video');
        if (domVideo && Number(domVideo.duration) > 0) {
            return (Number(domVideo.currentTime) / Number(domVideo.duration)) * 100;
        }
        return scrobbleSession.progress || 0;
    }

    function initScrobbleSessionFromData(data) {
        var pData = data || (window.Lampa && Lampa.Player && typeof Lampa.Player.playdata === 'function' ? Lampa.Player.playdata() : null) || {};
        var media = pData.movie || pData.card || null;
        if (!media && pData.playlist && pData.playlist.length > 0) {
            media = pData.playlist[0].movie || pData.playlist[0].card || null;
        }
        if (!media && window.Lampa && Lampa.Activity && typeof Lampa.Activity.active === 'function') {
            var activeAct = Lampa.Activity.active();
            if (activeAct && activeAct.movie) media = activeAct.movie;
        }

        if (!media || !media.id) {
            scrobbleSession.active = false;
            return false;
        }

        var tmdbId = parseInt(media.id, 10);
        if (isNaN(tmdbId) || tmdbId <= 0) {
            scrobbleSession.active = false;
            return false;
        }

        var hasSeasonOrEp = (pData.season !== undefined && pData.season !== null) ||
            (pData.episode !== undefined && pData.episode !== null) ||
            Boolean(pData.episode_data);
        var isShow = Boolean(media.first_air_date || hasSeasonOrEp);

        var seasonNum = 0;
        var episodeNum = 0;

        if (isShow) {
            if (pData.season !== undefined && pData.season !== null && pData.season !== '') {
                seasonNum = parseInt(pData.season, 10);
            } else if (pData.episode_data && pData.episode_data.season_number !== undefined) {
                seasonNum = parseInt(pData.episode_data.season_number, 10);
            } else {
                seasonNum = 1;
            }

            if (pData.episode !== undefined && pData.episode !== null && pData.episode !== '') {
                episodeNum = parseInt(pData.episode, 10);
            } else if (pData.episode_data && pData.episode_data.episode_number !== undefined) {
                episodeNum = parseInt(pData.episode_data.episode_number, 10);
            }

            if ((!episodeNum || isNaN(episodeNum)) && pData.title) {
                var seMatch = String(pData.title).match(/S(\d{1,2})\s*E(\d{1,3})/i) || String(pData.title).match(/(\d{1,2})x(\d{1,3})/i);
                if (seMatch) {
                    seasonNum = parseInt(seMatch[1], 10);
                    episodeNum = parseInt(seMatch[2], 10);
                }
            }
            if (isNaN(seasonNum)) seasonNum = 1;
            if (isNaN(episodeNum)) episodeNum = 0;
        }

        var imdbId = media.imdb_id || (media.external_ids && media.external_ids.imdb_id) || '';

        scrobbleSession.active = true;
        scrobbleSession.movie = media;
        scrobbleSession.isShow = isShow;
        scrobbleSession.season = seasonNum;
        scrobbleSession.episode = episodeNum;
        scrobbleSession.imdbId = imdbId ? String(imdbId) : '';
        scrobbleSession.tmdbId = tmdbId;
        scrobbleSession.progress = 0;
        scrobbleSession.startedSent = false;
        scrobbleSession.completedSent = false;
        scrobbleSession.paused = false;
        scrobbleSession.lastPauseProgress = -1;
        scrobbleSession.lastTickTs = 0;

        return true;
    }

    function completeScrobbleIfNeeded(progressVal) {
        if (!scrobbleSession.active || scrobbleSession.completedSent) return;
        scrobbleSession.completedSent = true;
        var finalProgress = Math.max(80, Math.round(Number(progressVal) || 80));
        var movieRef = scrobbleSession.movie;

        sendTraktScrobble('stop', scrobbleSession, finalProgress, function() {
            clearTraktWatchedCache();
            if (movieRef) {
                syncNativeLampaWatched(movieRef, true);
            }
        });
    }

    function attachPlayerScrobbler() {
        if (!window.Lampa) return;

        var onStart = function(data) {
            var settings = getSettings();
            if (!settings.autoScrobble || !isTraktLoggedIn()) return;
            if (!initScrobbleSessionFromData(data)) return;

            var initialProg = extractPlayerProgress(data);
            scrobbleSession.progress = initialProg;
            if (!scrobbleSession.startedSent) {
                scrobbleSession.startedSent = true;
                sendTraktScrobble('start', scrobbleSession, initialProg);
            }
        };

        var onPlayResume = function() {
            if (!scrobbleSession.active || scrobbleSession.completedSent) return;
            if (scrobbleSession.paused) {
                scrobbleSession.paused = false;
                var now = new Date().getTime();
                if (now - scrobbleSession.lastTickTs > 2500) {
                    scrobbleSession.lastTickTs = now;
                    sendTraktScrobble('start', scrobbleSession, scrobbleSession.progress);
                }
            }
        };

        var onPause = function(evData) {
            if (!scrobbleSession.active || scrobbleSession.completedSent) return;
            scrobbleSession.paused = true;
            var pct = extractPlayerProgress(evData);
            scrobbleSession.progress = pct;
            if (pct < 80 && Math.abs(Math.round(pct) - scrobbleSession.lastPauseProgress) >= 1) {
                scrobbleSession.lastPauseProgress = Math.round(pct);
                sendTraktScrobble('pause', scrobbleSession, pct);
            }
        };

        var onTimeUpdate = function(evData) {
            if (!scrobbleSession.active || scrobbleSession.completedSent) return;
            var now = new Date().getTime();
            if (now - scrobbleSession.lastTickTs < 2000) return;
            scrobbleSession.lastTickTs = now;

            var pct = extractPlayerProgress(evData);
            scrobbleSession.progress = pct;

            if (!scrobbleSession.startedSent && pct > 0 && pct < 80) {
                scrobbleSession.startedSent = true;
                sendTraktScrobble('start', scrobbleSession, pct);
            }

            if (pct >= 80) {
                completeScrobbleIfNeeded(pct);
            }
        };

        var onEnded = function() {
            if (!scrobbleSession.active) return;
            completeScrobbleIfNeeded(100);
        };

        var onDestroy = function() {
            if (!scrobbleSession.active) return;
            var pct = extractPlayerProgress(null);
            if (pct <= 0) pct = scrobbleSession.progress;

            if (!scrobbleSession.completedSent) {
                if (pct >= 80) {
                    completeScrobbleIfNeeded(pct);
                } else if (pct > 0) {
                    sendTraktScrobble('stop', scrobbleSession, pct);
                }
            }
            scrobbleSession.active = false;
        };

        if (Lampa.Player && Lampa.Player.listener && typeof Lampa.Player.listener.follow === 'function') {
            Lampa.Player.listener.follow('start', onStart);
            Lampa.Player.listener.follow('play', onPlayResume);
            Lampa.Player.listener.follow('pause', onPause);
            Lampa.Player.listener.follow('timeupdate', onTimeUpdate);
            Lampa.Player.listener.follow('ended', onEnded);
            Lampa.Player.listener.follow('destroy', onDestroy);
        }

        if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener && typeof Lampa.PlayerVideo.listener.follow === 'function') {
            Lampa.PlayerVideo.listener.follow('play', onPlayResume);
            Lampa.PlayerVideo.listener.follow('pause', onPause);
            Lampa.PlayerVideo.listener.follow('timeupdate', onTimeUpdate);
            Lampa.PlayerVideo.listener.follow('ended', onEnded);
            Lampa.PlayerVideo.listener.follow('stop', onDestroy);
        }

        if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
            Lampa.Listener.follow('player', function(e) {
                if (!e || !e.type) return;
                if (e.type === 'start') onStart(e.data || e);
                if (e.type === 'play') onPlayResume();
                if (e.type === 'pause') onPause(e.data || e);
                if (e.type === 'timeupdate') onTimeUpdate(e.data || e);
                if (e.type === 'ended') onEnded();
                if (e.type === 'destroy') onDestroy();
            });
        }

        logDebug('Слухач скробблінгу плеєра Trakt підключено');
    }

    function xhrTraktGet(url, traktClientId, onSuccess, onError) {
        var xhr = new XMLHttpRequest();
        var settled = false;

        var finishError = function(msg) {
            if (settled) return;
            settled = true;
            onError(msg);
        };

        var finishSuccess = function(data) {
            if (settled) return;
            settled = true;
            onSuccess(data);
        };

        xhr.open('GET', url, true);
        xhr.timeout = 12000;
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('trakt-api-version', '2');
        xhr.setRequestHeader('trakt-api-key', traktClientId);

        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4) return;
            logDebug('Trakt API відповідь:', url, 'status=' + xhr.status);
            if (xhr.status !== 200) {
                finishError('HTTP ' + xhr.status);
                return;
            }
            var parsed = null;
            try {
                parsed = JSON.parse(xhr.responseText);
            } catch (err) {
                finishError('Некоректний JSON від Trakt');
                return;
            }
            finishSuccess(parsed);
        };

        xhr.ontimeout = function() {
            finishError('Таймаут Trakt API');
        };

        xhr.onerror = function() {
            finishError('Помилка мережі Trakt API');
        };

        try {
            xhr.send();
        } catch (sendErr) {
            finishError('Помилка запиту Trakt');
        }
    }

    function fetchTraktRatings(movie, mdbJson, traktClientId, callback) {
        if (!traktClientId) {
            callback(createEmptyReactions('Вкажіть Trakt Client ID у Налаштуваннях', false));
            return;
        }

        var isShow = Boolean(movie.first_air_date);
        var endpointType = isShow ? 'shows' : 'movies';
        var searchType = isShow ? 'show' : 'movie';

        var directId = '';
        if (mdbJson && mdbJson.ids) {
            if (mdbJson.ids.trakt) {
                directId = String(mdbJson.ids.trakt);
            } else if (mdbJson.ids.imdb) {
                directId = String(mdbJson.ids.imdb);
            }
        }
        if (!directId) {
            directId = movie.imdb_id || (movie.external_ids && movie.external_ids.imdb_id) || '';
        }

        var fetchRatingsByTargetId = function(targetId, allowSearchFallback) {
            var ratingsUrl = 'https://api.trakt.tv/' + endpointType + '/' + encodeURIComponent(targetId) + '/ratings';
            logDebug('Запит Trakt ratings:', ratingsUrl);

            xhrTraktGet(ratingsUrl, traktClientId, function(data) {
                if (data && data.distribution) {
                    callback(distributionToReactions(data.distribution));
                } else {
                    callback(createEmptyReactions('Немає даних розподілу Trakt', false));
                }
            }, function(errMsg) {
                if (allowSearchFallback && errMsg.indexOf('401') === -1 && errMsg.indexOf('403') === -1) {
                    searchByTmdbId();
                } else {
                    var hint = (errMsg.indexOf('401') !== -1 || errMsg.indexOf('403') !== -1)
                        ? 'Невірний Trakt Client ID (' + errMsg + ')'
                        : 'Не вдалося завантажити оцінки Trakt (' + errMsg + ')';
                    callback(createEmptyReactions(hint, false));
                }
            });
        };

        var searchByTmdbId = function() {
            var searchUrl = 'https://api.trakt.tv/search/tmdb/' + movie.id + '?type=' + searchType;
            logDebug('Пошук Trakt ID через TMDB:', searchUrl);

            xhrTraktGet(searchUrl, traktClientId, function(results) {
                if (results && results.length > 0) {
                    var item = results[0];
                    var mediaObj = item[searchType] || item.movie || item.show;
                    var resolvedId = mediaObj && mediaObj.ids ? (mediaObj.ids.trakt || mediaObj.ids.slug || mediaObj.ids.imdb) : '';
                    if (resolvedId) {
                        fetchRatingsByTargetId(resolvedId, false);
                        return;
                    }
                }
                callback(createEmptyReactions('Фільм не знайдено на Trakt', false));
            }, function(errMsg) {
                var hint = (errMsg.indexOf('401') !== -1 || errMsg.indexOf('403') !== -1)
                    ? 'Невірний Trakt Client ID (' + errMsg + ')'
                    : 'Помилка пошуку Trakt (' + errMsg + ')';
                callback(createEmptyReactions(hint, false));
            });
        };

        if (directId) {
            fetchRatingsByTargetId(directId, true);
        } else {
            searchByTmdbId();
        }
    }

    function hasValidPositiveRatings(ratings) {
        if (!ratings || !ratings.length) return false;
        var i;
        for (i = 0; i < ratings.length; i++) {
            if (ratings[i] && Number(ratings[i].value) > 0) {
                return true;
            }
        }
        return false;
    }

    function xhrGetJson(url, onSuccess, onError) {
        var xhr = new XMLHttpRequest();
        var settled = false;

        var finishError = function(msg) {
            if (settled) return;
            settled = true;
            onError(msg);
        };

        var finishSuccess = function(data) {
            if (settled) return;
            settled = true;
            onSuccess(data);
        };

        xhr.open('GET', url, true);
        xhr.timeout = 12000;

        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4) return;
            logDebug('XHR відповідь:', url, 'status=' + xhr.status);
            if (xhr.status !== 200) {
                finishError('HTTP ' + xhr.status + (xhr.status === 0 ? ' (Network/CORS blocked)' : ''));
                return;
            }
            var parsed = null;
            try {
                parsed = JSON.parse(xhr.responseText);
                if (parsed && typeof parsed.contents === 'string' && !parsed.ratings) {
                    parsed = JSON.parse(parsed.contents);
                }
            } catch (parseErr) {
                finishError('Invalid JSON response');
                return;
            }
            if (!parsed || parsed.response === false || parsed.error) {
                var apiErr = (parsed && (parsed.error || parsed.message))
                    ? String(parsed.error || parsed.message)
                    : 'response: false';
                finishError('HTTP 200 (' + apiErr + ')');
                return;
            }
            if (!hasValidPositiveRatings(parsed.ratings)) {
                finishError('HTTP 200 (Порожній ratings)');
                return;
            }
            finishSuccess(parsed);
        };

        xhr.ontimeout = function() {
            finishError('Timeout (12s)');
        };

        xhr.onerror = function() {
            finishError('HTTP ' + xhr.status + ' / Network blocked');
        };

        try {
            xhr.send();
        } catch (sendErr) {
            finishError(sendErr && sendErr.message ? sendErr.message : 'XHR send failed');
        }
    }

    function fetchWithProxyChain(targetUrl, callback) {
        var attempts = new Array(
            { name: 'Direct', url: targetUrl },
            { name: 'corsproxy.io', url: 'https://corsproxy.io/?' + encodeURIComponent(targetUrl) },
            { name: 'allorigins', url: 'https://api.allorigins.win/raw?url=' + encodeURIComponent(targetUrl) }
        );
        var errors = new Array();

        function tryNext(idx) {
            if (idx >= attempts.length) {
                callback(errors.join(' | '), null);
                return;
            }
            var attempt = attempts[idx];
            logDebug('Спроба #' + (idx + 1) + ' (' + attempt.name + '):', attempt.url);

            xhrGetJson(attempt.url, function(json) {
                logDebug('Успіх через ' + attempt.name + ', рейтингів:', json.ratings.length);
                callback(null, json);
            }, function(errMsg) {
                var detail = attempt.name + ' -> ' + errMsg;
                logDebug('Невдача:', detail);
                errors.push(detail);
                tryNext(idx + 1);
            });
        }

        tryNext(0);
    }

    function fetchMdblistViaChain(movie, mdblistKey, callback) {
        if (!mdblistKey) {
            callback('NO_KEY', null);
            return;
        }

        var type = movie.first_air_date ? 'show' : 'movie';
        var targetUrl = 'https://api.mdblist.com/tmdb/' + type + '/' + movie.id + '?apikey=' + encodeURIComponent(mdblistKey);
        var imdbId = movie.imdb_id || (movie.external_ids && movie.external_ids.imdb_id) || '';

        fetchWithProxyChain(targetUrl, function(errSummary, json) {
            if (!errSummary && json) {
                callback(null, json);
                return;
            }
            var isAuthErr = errSummary && (errSummary.indexOf('HTTP 401') !== -1 || errSummary.indexOf('HTTP 403') !== -1 || errSummary.indexOf('Invalid API') !== -1);
            if (imdbId && !isAuthErr) {
                var imdbUrl = 'https://api.mdblist.com/imdb/' + imdbId + '?apikey=' + encodeURIComponent(mdblistKey);
                logDebug('Повторний пошук за IMDb ID через проксі-ланцюг:', imdbId);
                fetchWithProxyChain(imdbUrl, function(errSummary2, json2) {
                    if (!errSummary2 && json2) {
                        callback(null, json2);
                    } else {
                        callback(errSummary2 || errSummary, null);
                    }
                });
            } else {
                callback(errSummary, null);
            }
        });
    }

    function createSvgLogo(sourceKey, value) {
        var score = Number(value) || 0;

        if (sourceKey === 'imdb') {
            return '<svg class="mdb-svg" viewBox="0 0 48 48" width="32" height="32">' +
                '<rect x="2" y="2" width="44" height="44" rx="9" fill="#F5C518"/>' +
                '<text x="24" y="30" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="17" letter-spacing="-0.8" fill="#121212">IMDb</text>' +
                '</svg>';
        }

        if (sourceKey === 'trakt') {
            var gradId = 'mdb-trakt-grad-' + Math.round(score);
            return '<svg class="mdb-svg" viewBox="0 0 48 48" width="32" height="32">' +
                '<defs>' +
                '<linearGradient id="' + gradId + '" x1="0%" y1="100%" x2="100%" y2="0%">' +
                '<stop offset="0%" stop-color="#ED1C24"/>' +
                '<stop offset="100%" stop-color="#AF279C"/>' +
                '</linearGradient>' +
                '</defs>' +
                '<rect x="2" y="2" width="44" height="44" rx="10" fill="url(#' + gradId + ')"/>' +
                '<path d="M12 24 L20 32 L37 15" fill="none" stroke="#ffffff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>' +
                '<path d="M17 35 L39 13" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="2" stroke-linecap="round"/>' +
                '</svg>';
        }

        if (sourceKey === 'tmdb') {
            return '<svg class="mdb-svg mdb-svg-wide" viewBox="0 0 64 44" width="40" height="30">' +
                '<defs>' +
                '<linearGradient id="mdb-tmdb-g" x1="0%" y1="0%" x2="100%" y2="0%">' +
                '<stop offset="0%" stop-color="#90CEA1"/>' +
                '<stop offset="100%" stop-color="#01B4E4"/>' +
                '</linearGradient>' +
                '</defs>' +
                '<text x="2" y="13" font-family="Arial, sans-serif" font-weight="800" font-size="11" fill="url(#mdb-tmdb-g)">THE</text>' +
                '<rect x="29" y="5" width="30" height="8" rx="4" fill="url(#mdb-tmdb-g)"/>' +
                '<text x="2" y="26" font-family="Arial, sans-serif" font-weight="800" font-size="11.5" fill="url(#mdb-tmdb-g)">MOVIE</text>' +
                '<rect x="2" y="30" width="29" height="8" rx="4" fill="url(#mdb-tmdb-g)"/>' +
                '<text x="34" y="38" font-family="Arial, sans-serif" font-weight="800" font-size="11.5" fill="url(#mdb-tmdb-g)">DB</text>' +
                '</svg>';
        }

        if (sourceKey === 'letterboxd') {
            return '<svg class="mdb-svg mdb-svg-wide" viewBox="0 0 58 28" width="38" height="22">' +
                '<circle cx="13" cy="14" r="9.5" fill="#FF8000"/>' +
                '<circle cx="29" cy="14" r="9.5" fill="#00E054"/>' +
                '<circle cx="45" cy="14" r="9.5" fill="#40BCF4"/>' +
                '<path d="M21 7.6 A9.5 9.5 0 0 1 21 20.4 A9.5 9.5 0 0 1 21 7.6 Z" fill="#B2B500" opacity="0.65"/>' +
                '<path d="M37 7.6 A9.5 9.5 0 0 1 37 20.4 A9.5 9.5 0 0 1 37 7.6 Z" fill="#00B0B0" opacity="0.65"/>' +
                '</svg>';
        }

        if (sourceKey === 'tomatoes') {
            if (score >= 75) {
                return '<svg class="mdb-svg" viewBox="0 0 48 48" width="32" height="32">' +
                    '<circle cx="24" cy="24" r="21" fill="#F9E500" stroke="#008A2E" stroke-width="3"/>' +
                    '<circle cx="24" cy="25" r="14.5" fill="#FA320A"/>' +
                    '<path d="M24 9 L26 15 L32 13 L27 18 L24 16 L21 18 L16 13 L22 15 Z" fill="#0AC855"/>' +
                    '<rect x="11" y="19" width="26" height="10" rx="2.5" fill="#FA320A"/>' +
                    '<text x="24" y="26.5" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="7.5" fill="#FFFFFF">FRESH</text>' +
                    '</svg>';
            }
            if (score >= 60) {
                return '<svg class="mdb-svg" viewBox="0 0 48 48" width="32" height="32">' +
                    '<circle cx="24" cy="26" r="17" fill="#FA320A"/>' +
                    '<ellipse cx="18" cy="20" rx="4" ry="2.2" transform="rotate(-30 18 20)" fill="rgba(255,255,255,0.35)"/>' +
                    '<path d="M24 6 L27 13 L35 11 L28 16 L24 14 L20 16 L13 11 L21 13 Z" fill="#0AC855"/>' +
                    '</svg>';
            }
            return '<svg class="mdb-svg" viewBox="0 0 48 48" width="32" height="32">' +
                '<path d="M24 8 L29 15 L38 11 L35 20 L43 24 L35 30 L39 38 L29 35 L24 42 L19 35 L9 38 L13 30 L5 24 L13 20 L10 11 L19 15 Z" fill="#0AC855"/>' +
                '<circle cx="21" cy="22" r="2.2" fill="#065A26"/>' +
                '<circle cx="28" cy="27" r="1.8" fill="#065A26"/>' +
                '</svg>';
        }

        if (sourceKey === 'popcorn') {
            if (score >= 60) {
                return '<svg class="mdb-svg" viewBox="0 0 48 48" width="32" height="32">' +
                    '<path d="M24 2 L43 11 L43 32 L24 45 L5 32 L5 11 Z" fill="#1AB8B0" opacity="0.28"/>' +
                    '<circle cx="17" cy="15" r="5" fill="#FFF3B0"/>' +
                    '<circle cx="24" cy="12" r="5.5" fill="#FFE066"/>' +
                    '<circle cx="31" cy="15" r="5" fill="#FFF3B0"/>' +
                    '<polygon points="12,18 36,18 33,42 15,42" fill="#FFFFFF"/>' +
                    '<polygon points="15,18 20,18 19,42 16,42" fill="#E62E2D"/>' +
                    '<polygon points="23,18 27,18 26,42 23,42" fill="#E62E2D"/>' +
                    '<polygon points="30,18 34,18 32,42 29,42" fill="#E62E2D"/>' +
                    '<rect x="13" y="24" width="22" height="10" rx="2" fill="#FFCC00"/>' +
                    '<text x="24" y="31.5" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="7.5" fill="#B31217">HOT</text>' +
                    '</svg>';
            }
            return '<svg class="mdb-svg" viewBox="0 0 48 48" width="32" height="32">' +
                '<polygon points="13,18 35,18 32,42 16,42" fill="#89A894"/>' +
                '<polygon points="17,18 22,18 21,42 18,42" fill="#3B6E4C"/>' +
                '<polygon points="26,18 31,18 30,42 27,42" fill="#3B6E4C"/>' +
                '<circle cx="20" cy="15" r="4.5" fill="#C9D6B8"/>' +
                '<circle cx="28" cy="16" r="4.5" fill="#B6C7A3"/>' +
                '</svg>';
        }

        if (sourceKey === 'metacritic') {
            return '<svg class="mdb-svg" viewBox="0 0 48 48" width="32" height="32">' +
                '<circle cx="24" cy="20" r="15" fill="#1B1D22" stroke="#D4AF37" stroke-width="2.5"/>' +
                '<text x="24" y="25" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="16" fill="#FFCC33" transform="rotate(-18 24 20)">m</text>' +
                '<rect x="7" y="29" width="34" height="11" rx="2.5" fill="#D4AF37"/>' +
                '<text x="24" y="37" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="6.8" fill="#111111">METACRITIC</text>' +
                '</svg>';
        }

        return '';
    }

    function createTextBadge(sourceKey) {
        var map = {
            imdb: { label: 'IMDb', bg: '#F5C518', fg: '#111111' },
            trakt: { label: 'TRAKT', bg: '#ED1C24', fg: '#FFFFFF' },
            tmdb: { label: 'TMDB', bg: '#01B4E4', fg: '#FFFFFF' },
            letterboxd: { label: 'LBXD', bg: '#00E054', fg: '#111111' },
            tomatoes: { label: 'RT', bg: '#FA320A', fg: '#FFFFFF' },
            popcorn: { label: 'POP', bg: '#FFCC00', fg: '#111111' },
            metacritic: { label: 'MC', bg: '#D4AF37', fg: '#111111' }
        };
        var info = map[sourceKey] || { label: sourceKey.toUpperCase(), bg: '#444', fg: '#FFF' };
        return '<span class="mdb-text-badge" style="background:' + info.bg + ';color:' + info.fg + ';">' + info.label + '</span>';
    }

    function formatRatingParts(sourceKey, r) {
        var val = Number(r.value);
        if (sourceKey === 'imdb') {
            return { score: val.toFixed(1), denom: '/10' };
        }
        if (sourceKey === 'trakt') {
            return { score: String(Math.round(val)), denom: '%' };
        }
        if (sourceKey === 'tmdb') {
            return { score: String(Math.round(val)), denom: '/100' };
        }
        if (sourceKey === 'letterboxd') {
            return { score: val.toFixed(1), denom: '/5' };
        }
        if (sourceKey === 'tomatoes') {
            return { score: String(Math.round(val)), denom: '%' };
        }
        if (sourceKey === 'popcorn') {
            return { score: String(Math.round(val)), denom: '%' };
        }
        if (sourceKey === 'metacritic') {
            return { score: String(Math.round(val)), denom: '/100' };
        }
        return { score: String(val), denom: '' };
    }

    function getUserLocalVote(mediaVoteKey) {
        if (!window.Lampa || !Lampa.Storage) return '';
        return getStorageStr(VOTE_PREFIX + mediaVoteKey, '');
    }

    function setUserLocalVote(mediaVoteKey, reactionKey) {
        if (!window.Lampa || !Lampa.Storage) return;
        if (reactionKey) {
            Lampa.Storage.set(VOTE_PREFIX + mediaVoteKey, reactionKey);
        } else {
            Lampa.Storage.remove(VOTE_PREFIX + mediaVoteKey);
        }
    }

    function buildSortedPillsList(reactions, activeVote, initialTraktVote, loggedIn) {
        var list = new Array();
        var i;
        for (i = 0; i < REACTION_DEFS.length; i++) {
            var def = REACTION_DEFS[i];
            var baseCount = Number(reactions[def.key]) || 0;
            var isSelected = (activeVote === def.key);
            var delta = 0;

            if (loggedIn) {
                if (isSelected && initialTraktVote !== def.key) delta = 1;
                if (!isSelected && initialTraktVote === def.key) delta = -1;
            } else {
                if (isSelected) delta = 1;
            }

            list.push({
                key: def.key,
                emoji: def.emoji,
                png: def.png,
                barColor: def.barColor,
                label: def.label,
                order: def.order,
                count: Math.max(0, baseCount + delta),
                isSelected: isSelected
            });
        }

        list.sort(function(a, b) {
            if (b.count !== a.count) return b.count - a.count;
            return a.order - b.order;
        });

        return list;
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        var css = '' +
            '.full-start__rate-line, .full-start-new__rate-line {' +
            '  display: none !important;' +
            '}' +
            '.mdb-title-medium { font-size: 2.3em !important; line-height: 1.15 !important; }' +
            '.mdb-title-compact { font-size: 1.9em !important; line-height: 1.15 !important; }' +
            '.mdb-title-small { font-size: 1.6em !important; line-height: 1.15 !important; }' +

            '.mdb-tagline-compact { font-size: 1.05em !important; opacity: 0.78 !important; }' +
            '.mdb-tagline-small { font-size: 0.9em !important; opacity: 0.75 !important; }' +
            '.mdb-tagline-hidden { display: none !important; }' +

            '.mdb-buttons-compact .full-start__button { font-size: 0.88em !important; }' +
            '.mdb-buttons-small .full-start__button { font-size: 0.78em !important; }' +

            '.mdb-desc-compact { font-size: 1.05em !important; line-height: 1.38 !important; }' +
            '.mdb-desc-small { font-size: 0.92em !important; line-height: 1.32 !important; }' +
            '.mdb-desc-hidden { display: none !important; }' +

            '.mdb-reactions-wrapper {' +
            '  position: relative;' +
            '  z-index: 2;' +
            '  display: block !important;' +
            '  width: 100%;' +
            '  margin: 0.75em 0 1.15em 0;' +
            '  transform-origin: left top;' +
            '  box-sizing: border-box;' +
            '}' +
            '.mdb-reactions-wrapper.mdb-scale-085 { zoom: 0.85; }' +
            '.mdb-reactions-wrapper.mdb-scale-10 { zoom: 1; }' +
            '.mdb-reactions-wrapper.mdb-scale-115 { zoom: 1.15; }' +

            'body.cardify .mdb-reactions-wrapper, .cardify .mdb-reactions-wrapper, body.cardify .mdb-pills-row, .cardify .mdb-pills-row {' +
            '  overflow: visible !important;' +
            '}' +
            'body.cardify .mdb-pill-btn:first-child .mdb-tooltip, .cardify .mdb-pill-btn:first-child .mdb-tooltip {' +
            '  left: 0 !important;' +
            '  right: auto !important;' +
            '  transform: none !important;' +
            '}' +

            '.mdb-watched-row {' +
            '  display: flex !important;' +
            '  align-items: center;' +
            '  margin-bottom: 0.65em;' +
            '}' +
            '.mdb-watched-badge {' +
            '  display: inline-flex;' +
            '  align-items: center;' +
            '  gap: 0.35em;' +
            '  padding: 0.28em 0.78em;' +
            '  border-radius: 999px;' +
            '  font-size: 0.88em;' +
            '  font-weight: 600;' +
            '  line-height: 1.2;' +
            '  user-select: none;' +
            '}' +
            '.mdb-watched-badge.is-watched {' +
            '  background: rgba(46, 204, 113, 0.18);' +
            '  border: 1px solid rgba(46, 204, 113, 0.48);' +
            '  color: #69f0ae;' +
            '}' +
            '.mdb-watched-badge.is-watched-full {' +
            '  background: rgba(46, 204, 113, 0.28);' +
            '  border: 1px solid rgba(46, 204, 113, 0.72);' +
            '  color: #b9f6ca;' +
            '}' +

            '.mdb-trakt-watched-btn {' +
            '  position: relative;' +
            '  display: inline-flex;' +
            '  align-items: center;' +
            '  justify-content: center;' +
            '}' +
            '.mdb-trakt-watched-btn svg {' +
            '  width: 1.35em;' +
            '  height: 1.35em;' +
            '  flex-shrink: 0;' +
            '  display: block;' +
            '}' +
            '.mdb-trakt-watched-btn > span {' +
            '  display: none;' +
            '  white-space: nowrap;' +
            '}' +
            '.mdb-trakt-watched-btn.is-watched {' +
            '  background: rgba(255, 255, 255, 0.22);' +
            '  border: 1.5px solid rgba(255, 255, 255, 0.85);' +
            '  color: #ffffff;' +
            '}' +
            '.mdb-trakt-watched-btn.focus, .mdb-trakt-watched-btn:hover {' +
            '  background: #ffffff !important;' +
            '  border-color: #ffffff !important;' +
            '  color: #000000 !important;' +
            '}' +
            '.mdb-trakt-watched-btn.focus > span, .mdb-trakt-watched-btn:hover > span {' +
            '  display: inline-block;' +
            '  margin-left: 0.45em;' +
            '  color: #000000;' +
            '}' +

            '.mdb-pills-row {' +
            '  display: flex !important;' +
            '  flex-wrap: wrap !important;' +
            '  align-items: center !important;' +
            '  gap: 0.6em;' +
            '  margin-bottom: 0.95em;' +
            '}' +

            '.mdb-pill {' +
            '  position: relative;' +
            '  display: inline-flex;' +
            '  align-items: center;' +
            '  gap: 0.48em;' +
            '  padding: 0.42em 0.95em;' +
            '  border-radius: 999px;' +
            '  cursor: pointer;' +
            '  user-select: none;' +
            '  transition: transform 0.16s ease, background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;' +
            '  color: #ffffff;' +
            '  font-size: 1.05em;' +
            '  font-weight: 600;' +
            '  border: 1px solid rgba(255, 255, 255, 0.12);' +
            '}' +

            '.mdb-style-glass .mdb-pill {' +
            '  background: rgba(255, 255, 255, 0.11);' +
            '  backdrop-filter: blur(8px);' +
            '  -webkit-backdrop-filter: blur(8px);' +
            '}' +
            '.mdb-style-solid .mdb-pill {' +
            '  background: #23252c;' +
            '  border-color: rgba(255, 255, 255, 0.1);' +
            '}' +
            '.mdb-style-outline .mdb-pill {' +
            '  background: rgba(0, 0, 0, 0.18);' +
            '  border: 1.5px solid rgba(255, 255, 255, 0.28);' +
            '}' +
            '.mdb-style-compact .mdb-pill {' +
            '  background: rgba(255, 255, 255, 0.1);' +
            '  padding: 0.28em 0.72em;' +
            '  font-size: 0.92em;' +
            '  gap: 0.35em;' +
            '}' +

            '.mdb-pill.focus, .mdb-pill:hover {' +
            '  transform: scale(1.06);' +
            '  background: rgba(255, 255, 255, 0.24);' +
            '  border-color: rgba(255, 255, 255, 0.85);' +
            '  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);' +
            '}' +

            '.mdb-pill.active[data-reaction-key="masterpiece"] {' +
            '  background: rgba(255, 107, 0, 0.38) !important;' +
            '  border: 2px solid #ff9500 !important;' +
            '  box-shadow: 0 0 16px rgba(255, 107, 0, 0.55) !important;' +
            '}' +
            '.mdb-pill.active[data-reaction-key="worth"] {' +
            '  background: rgba(46, 204, 113, 0.35) !important;' +
            '  border: 2px solid #2ecc71 !important;' +
            '  box-shadow: 0 0 16px rgba(46, 204, 113, 0.5) !important;' +
            '}' +
            '.mdb-pill.active[data-reaction-key="once"] {' +
            '  background: rgba(241, 196, 15, 0.32) !important;' +
            '  border: 2px solid #f1c40f !important;' +
            '  box-shadow: 0 0 16px rgba(241, 196, 15, 0.45) !important;' +
            '}' +
            '.mdb-pill.active[data-reaction-key="boring"] {' +
            '  background: rgba(52, 152, 219, 0.35) !important;' +
            '  border: 2px solid #3498db !important;' +
            '  box-shadow: 0 0 16px rgba(52, 152, 219, 0.5) !important;' +
            '}' +
            '.mdb-pill.active[data-reaction-key="weak"] {' +
            '  background: rgba(231, 76, 60, 0.35) !important;' +
            '  border: 2px solid #e74c3c !important;' +
            '  box-shadow: 0 0 16px rgba(231, 76, 60, 0.5) !important;' +
            '}' +
            '.mdb-pill.active .mdb-pill-count {' +
            '  color: #ffffff !important;' +
            '  font-weight: 700 !important;' +
            '}' +

            '.mdb-pill-icon {' +
            '  display: inline-flex;' +
            '  align-items: center;' +
            '  justify-content: center;' +
            '  line-height: 1;' +
            '}' +
            '.mdb-pill-emoji-img {' +
            '  width: 1.38em;' +
            '  height: 1.38em;' +
            '  object-fit: contain;' +
            '  display: block;' +
            '}' +
            '.mdb-pill-emoji-unicode {' +
            '  font-size: 1.22em;' +
            '  line-height: 1;' +
            '}' +

            '.mdb-emoji-anim .mdb-pill-icon {' +
            '  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);' +
            '}' +
            '.mdb-emoji-anim .mdb-pill.focus .mdb-pill-icon, .mdb-emoji-anim .mdb-pill:hover .mdb-pill-icon {' +
            '  transform: scale(1.22) rotate(-6deg);' +
            '}' +

            '.mdb-emoji-glow .mdb-pill[data-reaction-key="masterpiece"] .mdb-pill-icon {' +
            '  filter: drop-shadow(0 0 6px rgba(255, 94, 20, 0.65));' +
            '}' +
            '.mdb-emoji-glow .mdb-pill[data-reaction-key="worth"] .mdb-pill-icon {' +
            '  filter: drop-shadow(0 0 6px rgba(255, 204, 0, 0.55));' +
            '}' +
            '.mdb-emoji-glow .mdb-pill[data-reaction-key="once"] .mdb-pill-icon {' +
            '  filter: drop-shadow(0 0 6px rgba(255, 193, 7, 0.45));' +
            '}' +
            '.mdb-emoji-glow .mdb-pill[data-reaction-key="boring"] .mdb-pill-icon {' +
            '  filter: drop-shadow(0 0 6px rgba(100, 149, 237, 0.55));' +
            '}' +
            '.mdb-emoji-glow .mdb-pill[data-reaction-key="weak"] .mdb-pill-icon {' +
            '  filter: drop-shadow(0 0 6px rgba(181, 115, 65, 0.55));' +
            '}' +

            '.mdb-pill-count {' +
            '  position: relative;' +
            '  z-index: 1;' +
            '  font-variant-numeric: tabular-nums;' +
            '  letter-spacing: 0.01em;' +
            '}' +

            '.mdb-pill-bar-track {' +
            '  position: absolute;' +
            '  left: 0;' +
            '  right: 0;' +
            '  top: 0;' +
            '  bottom: 0;' +
            '  border-radius: 999px;' +
            '  overflow: hidden;' +
            '  pointer-events: none;' +
            '}' +
            '.mdb-pill-bar-fill {' +
            '  position: absolute;' +
            '  left: 0;' +
            '  bottom: 0;' +
            '  height: 2px;' +
            '  transition: width 0.3s ease;' +
            '}' +

            '.mdb-pill-tooltip {' +
            '  position: absolute;' +
            '  bottom: calc(100% + 7px);' +
            '  left: 50%;' +
            '  transform: translateX(-50%) translateY(4px);' +
            '  background: rgba(20, 22, 27, 0.96);' +
            '  color: #ffffff;' +
            '  border: 1px solid rgba(255, 255, 255, 0.18);' +
            '  border-radius: 6px;' +
            '  padding: 0.25em 0.6em;' +
            '  font-size: 0.78em;' +
            '  font-weight: 500;' +
            '  white-space: nowrap;' +
            '  pointer-events: none;' +
            '  opacity: 0;' +
            '  transition: opacity 0.15s ease, transform 0.15s ease;' +
            '  z-index: 20;' +
            '}' +
            '.mdb-pill.focus .mdb-pill-tooltip, .mdb-pill:hover .mdb-pill-tooltip {' +
            '  opacity: 1;' +
            '  transform: translateX(-50%) translateY(0);' +
            '}' +

            '.mdb-ratings-row {' +
            '  display: flex !important;' +
            '  flex-wrap: wrap !important;' +
            '  align-items: center !important;' +
            '  gap: 0.9em 1.5em;' +
            '  width: 100%;' +
            '}' +

            '.mdb-rating-item {' +
            '  display: inline-flex;' +
            '  flex-direction: column;' +
            '  align-items: flex-start;' +
            '}' +

            '.mdb-rating-top {' +
            '  display: inline-flex;' +
            '  align-items: center;' +
            '  gap: 0.5em;' +
            '}' +

            '.mdb-badge-icon {' +
            '  display: inline-flex;' +
            '  align-items: center;' +
            '  justify-content: center;' +
            '  flex-shrink: 0;' +
            '}' +
            '.mdb-badges-monochrome .mdb-badge-icon {' +
            '  filter: grayscale(100%) contrast(1.15) opacity(0.85);' +
            '}' +
            '.mdb-svg {' +
            '  display: block;' +
            '}' +
            '.mdb-text-badge {' +
            '  display: inline-block;' +
            '  padding: 0.22em 0.52em;' +
            '  border-radius: 5px;' +
            '  font-size: 0.78em;' +
            '  font-weight: 800;' +
            '  letter-spacing: 0.03em;' +
            '  line-height: 1.15;' +
            '}' +

            '.mdb-score-group {' +
            '  display: inline-flex;' +
            '  align-items: baseline;' +
            '  line-height: 1;' +
            '}' +
            '.mdb-score-val {' +
            '  color: #ffffff;' +
            '  font-size: 1.42em;' +
            '  font-weight: 800;' +
            '  letter-spacing: -0.02em;' +
            '}' +
            '.mdb-score-denom {' +
            '  color: rgba(255, 255, 255, 0.52);' +
            '  font-size: 0.92em;' +
            '  font-weight: 500;' +
            '  margin-left: 0.12em;' +
            '}' +

            '.mdb-votes-sub {' +
            '  margin-top: 0.28em;' +
            '  color: rgba(255, 255, 255, 0.55);' +
            '  font-size: 0.8em;' +
            '  font-weight: 400;' +
            '  line-height: 1.1;' +
            '}' +

            '.mdb-loading-badge {' +
            '  display: inline-block;' +
            '  font-size: 0.85em;' +
            '  color: rgba(255, 255, 255, 0.55);' +
            '}' +

            '.mdb-hint-badge {' +
            '  display: inline-block;' +
            '  padding: 0.35em 0.7em;' +
            '  border-radius: 6px;' +
            '  font-size: 0.84em;' +
            '  color: rgba(255, 255, 255, 0.65);' +
            '  background: rgba(255, 255, 255, 0.07);' +
            '  border: 1px solid rgba(255, 255, 255, 0.16);' +
            '}' +

            '.mdb-error-badge {' +
            '  display: inline-block;' +
            '  padding: 0.38em 0.75em;' +
            '  border-radius: 6px;' +
            '  font-size: 0.86em;' +
            '  font-weight: 600;' +
            '  color: #ff8a65;' +
            '  background: rgba(255, 82, 82, 0.16);' +
            '  border: 1px solid rgba(255, 110, 64, 0.48);' +
            '  line-height: 1.35;' +
            '  word-break: break-word;' +
            '}' +

            '.mdb-trakt-auth-modal {' +
            '  text-align: center;' +
            '  padding: 1.2em 1em;' +
            '  color: #ffffff;' +
            '}' +
            '.mdb-auth-desc {' +
            '  font-size: 1.05em;' +
            '  color: rgba(255, 255, 255, 0.82);' +
            '  margin: 0.6em 0;' +
            '}' +
            '.mdb-auth-url {' +
            '  display: inline-block;' +
            '  font-size: 1.35em;' +
            '  font-weight: 700;' +
            '  color: #64b5f6;' +
            '  margin: 0.3em 0 1em 0;' +
            '}' +
            '.mdb-auth-code {' +
            '  display: inline-block;' +
            '  margin: 0.45em 0 1em 0;' +
            '  padding: 0.35em 0.85em;' +
            '  font-size: 2.5em;' +
            '  font-weight: 900;' +
            '  letter-spacing: 0.18em;' +
            '  color: #ffffff;' +
            '  background: rgba(255, 255, 255, 0.14);' +
            '  border: 2px solid rgba(255, 255, 255, 0.38);' +
            '  border-radius: 12px;' +
            '}' +
            '.mdb-auth-status {' +
            '  font-size: 0.95em;' +
            '  color: rgba(255, 255, 255, 0.65);' +
            '  margin-top: 0.4em;' +
            '}';

        var styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.type = 'text/css';
        styleEl.appendChild(document.createTextNode(css));
        document.head.appendChild(styleEl);
    }

    function applyCardTypographyAndButtonStyles(rootEl, settings) {
        if (!rootEl || !rootEl.querySelectorAll) return;

        var titleNodes = rootEl.querySelectorAll('.full-start__title, .full-start-new__title');
        var i;
        for (i = 0; i < titleNodes.length; i++) {
            var tNode = titleNodes[i];
            tNode.classList.remove('mdb-title-medium');
            tNode.classList.remove('mdb-title-compact');
            tNode.classList.remove('mdb-title-small');
            if (settings.titleSize && settings.titleSize !== 'default') {
                tNode.classList.add('mdb-title-' + settings.titleSize);
            }
        }

        var tagNodes = rootEl.querySelectorAll('.full-start__tagline, .full-start-new__tagline');
        for (i = 0; i < tagNodes.length; i++) {
            var gNode = tagNodes[i];
            gNode.classList.remove('mdb-tagline-compact');
            gNode.classList.remove('mdb-tagline-small');
            gNode.classList.remove('mdb-tagline-hidden');
            if (settings.taglineSize && settings.taglineSize !== 'default') {
                gNode.classList.add('mdb-tagline-' + settings.taglineSize);
            }
        }

        var btnRows = rootEl.querySelectorAll('.full-start__buttons, .full-start-new__buttons');
        for (i = 0; i < btnRows.length; i++) {
            var bRow = btnRows[i];
            bRow.classList.remove('mdb-buttons-compact');
            bRow.classList.remove('mdb-buttons-small');
            if (settings.buttonsSize && settings.buttonsSize !== 'default') {
                bRow.classList.add('mdb-buttons-' + settings.buttonsSize);
            }
        }

        var descNodes = rootEl.querySelectorAll('.full-start__description, .full-start-new__description');
        for (i = 0; i < descNodes.length; i++) {
            var dNode = descNodes[i];
            dNode.classList.remove('mdb-desc-compact');
            dNode.classList.remove('mdb-desc-small');
            dNode.classList.remove('mdb-desc-hidden');
            if (settings.descSize && settings.descSize !== 'default') {
                dNode.classList.add('mdb-desc-' + settings.descSize);
            }
        }
    }

    function createWatchedStatusRow(data) {
        var ws = data.watchedStatus;
        if (!ws) return null;

        var badgeText = '';
        var badgeClass = '';

        if (ws.isShow) {
            if (ws.watchedEpisodes <= 0) return null;
            if (ws.totalEpisodes > 0) {
                badgeText = '✓ Переглянуто ' + ws.watchedEpisodes + ' з ' + ws.totalEpisodes + ' серій';
                badgeClass = (ws.watchedEpisodes >= ws.totalEpisodes) ? 'is-watched-full' : 'is-watched';
            } else {
                badgeText = '✓ Переглянуто ' + ws.watchedEpisodes + ' серій';
                badgeClass = 'is-watched';
            }
        } else {
            if (!ws.watched) return null;
            badgeText = '✓ Переглянуто';
            badgeClass = 'is-watched';
        }

        var row = document.createElement('div');
        row.className = 'mdb-watched-row';

        var badge = document.createElement('div');
        badge.className = 'mdb-watched-badge ' + badgeClass;
        badge.textContent = badgeText;
        row.appendChild(badge);

        return row;
    }

    function getWatchedActionSvg(isWatched) {
        if (isWatched) {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>' +
                '<path d="M9.5 12l2 2 4-4"/>' +
                '</svg>';
        }
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>' +
            '<circle cx="12" cy="12" r="3"/>' +
            '</svg>';
    }

    function syncWatchedActionButton(rootEl, movie, data) {
        if (!rootEl || !rootEl.querySelector) return;

        var oldBtns = rootEl.querySelectorAll('.mdb-trakt-watched-btn');
        var i;
        for (i = 0; i < oldBtns.length; i++) {
            if (oldBtns[i].parentNode) {
                oldBtns[i].parentNode.removeChild(oldBtns[i]);
            }
        }

        if (!isTraktLoggedIn()) return;

        var buttonsContainer = rootEl.querySelector('.full-start-new__buttons, .full-start__buttons');
        if (!buttonsContainer) return;

        var ws = data.watchedStatus;
        var isCurrentlyWatched = Boolean(ws && (ws.isShow ? (ws.watchedEpisodes > 0) : ws.watched));

        var btn = document.createElement('div');
        btn.className = 'full-start__button selector mdb-trakt-watched-btn' + (isCurrentlyWatched ? ' is-watched' : '');

        var updateBtnVisual = function(watchedState) {
            if (watchedState) {
                btn.classList.add('is-watched');
            } else {
                btn.classList.remove('is-watched');
            }
            btn.innerHTML = getWatchedActionSvg(watchedState) + '<span>Переглянуто</span>';
        };

        updateBtnVisual(isCurrentlyWatched);

        var lastBtnTapTs = 0;
        var handleBtnClick = function(ev) {
            if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
            var now = new Date().getTime();
            if (now - lastBtnTapTs < 350) return;
            lastBtnTapTs = now;

            var curWs = data.watchedStatus;
            var currentlyMarked = Boolean(curWs && (curWs.isShow ? (curWs.watchedEpisodes > 0) : curWs.watched));
            var targetMark = !currentlyMarked;

            toggleWatchedOnTrakt(movie, data.mdbJson || null, targetMark, function(ok, newVal) {
                if (!ok) return;
                var isShow = Boolean(movie.first_air_date);
                if (!data.watchedStatus) {
                    data.watchedStatus = buildWatchedStatusObj(newVal, movie, data.mdbJson || null);
                } else if (isShow) {
                    data.watchedStatus.watchedEpisodes = Number(newVal) || 0;
                    data.watchedStatus.watched = data.watchedStatus.watchedEpisodes > 0 &&
                        (data.watchedStatus.totalEpisodes <= 0 || data.watchedStatus.watchedEpisodes >= data.watchedStatus.totalEpisodes);
                } else {
                    data.watchedStatus.watched = Boolean(targetMark);
                }

                renderIntoCard(rootEl, movie, data);

                var newBtn = rootEl.querySelector('.mdb-trakt-watched-btn');
                if (newBtn && window.Lampa && Lampa.Controller && typeof Lampa.Controller.collectionFocus === 'function') {
                    try {
                        Lampa.Controller.collectionFocus(newBtn);
                    } catch (eFocus) {
                        /* ignore */
                    }
                }
            });
        };

        btn.addEventListener('click', handleBtnClick);
        if (window.$) {
            window.$(btn).on('hover:enter', handleBtnClick);
        } else {
            btn.addEventListener('hover:enter', handleBtnClick);
        }

        var optionsBtn = buttonsContainer.querySelector('.button--options');
        if (optionsBtn && optionsBtn.parentNode === buttonsContainer) {
            buttonsContainer.insertBefore(btn, optionsBtn);
        } else {
            buttonsContainer.appendChild(btn);
        }
    }

    function buildWrapperElement(data, movie, settings) {
        var type = movie.first_air_date ? 'show' : 'movie';
        var mediaVoteKey = type + '_' + movie.id;

        var wrapper = document.createElement('div');
        var scaleClass = 'mdb-scale-10';
        if (settings.scale === '0.85') scaleClass = 'mdb-scale-085';
        if (settings.scale === '1.15') scaleClass = 'mdb-scale-115';

        wrapper.className = 'mdb-reactions-wrapper mdb-style-' + settings.pillStyle +
            ' mdb-badges-' + settings.badgeStyle + ' ' + scaleClass +
            (settings.emojiGlow ? ' mdb-emoji-glow' : '') +
            (settings.emojiAnim ? ' mdb-emoji-anim' : '');

        if (settings.showWatchedBadge && isTraktLoggedIn() && data.watchedStatus) {
            var watchedRow = createWatchedStatusRow(data);
            if (watchedRow) {
                wrapper.appendChild(watchedRow);
            }
        }

        if (settings.showPills && data.reactions) {
            var pillsRow = document.createElement('div');
            pillsRow.className = 'mdb-pills-row lampa-pill-row';
            var lastTapTs = 0;

            var renderSortedPills = function(focusKey) {
                while (pillsRow.firstChild) {
                    pillsRow.removeChild(pillsRow.firstChild);
                }

                var loggedIn = isTraktLoggedIn();
                var activeVote = loggedIn
                    ? (data.userTraktVote !== undefined ? data.userTraktVote : '')
                    : getUserLocalVote(mediaVoteKey);
                var initialTraktVote = data.initialTraktVote || '';
                var sortedPills = buildSortedPillsList(data.reactions, activeVote, initialTraktVote, loggedIn);
                var hintSuffix = data.reactions.hintText ? (' (' + data.reactions.hintText + ')') : '';
                var totalVotes = 0;
                var i;

                for (i = 0; i < sortedPills.length; i++) {
                    totalVotes += sortedPills[i].count;
                }

                for (i = 0; i < sortedPills.length; i++) {
                    (function(item) {
                        var pill = document.createElement('div');
                        pill.className = 'mdb-pill lampa-pill-btn mdb-pill-btn selector' + (item.isSelected ? ' active' : '');
                        pill.setAttribute('data-reaction-key', item.key);

                        var tooltip = document.createElement('span');
                        tooltip.className = 'mdb-pill-tooltip mdb-tooltip';
                        tooltip.textContent = item.label + hintSuffix;

                        var iconWrap = document.createElement('span');
                        iconWrap.className = 'mdb-pill-icon';

                        if (settings.usePngEmojis && item.png) {
                            var imgEl = document.createElement('img');
                            imgEl.className = 'mdb-pill-emoji-img';
                            imgEl.src = item.png;
                            imgEl.alt = item.emoji;
                            imgEl.onerror = function() {
                                if (imgEl.parentNode) {
                                    var fallbackSpan = document.createElement('span');
                                    fallbackSpan.className = 'mdb-pill-emoji-unicode';
                                    fallbackSpan.textContent = item.emoji;
                                    imgEl.parentNode.replaceChild(fallbackSpan, imgEl);
                                }
                            };
                            iconWrap.appendChild(imgEl);
                        } else {
                            var unicodeSpan = document.createElement('span');
                            unicodeSpan.className = 'mdb-pill-emoji-unicode';
                            unicodeSpan.textContent = item.emoji;
                            iconWrap.appendChild(unicodeSpan);
                        }

                        var countEl = document.createElement('span');
                        countEl.className = 'mdb-pill-count';
                        countEl.textContent = formatPillCount(item.count);

                        pill.appendChild(tooltip);
                        pill.appendChild(iconWrap);
                        pill.appendChild(countEl);

                        if (settings.emojiBar) {
                            var pct = totalVotes > 0 ? Math.round((item.count / totalVotes) * 100) : 0;
                            var barTrack = document.createElement('span');
                            barTrack.className = 'mdb-pill-bar-track';

                            var barFill = document.createElement('span');
                            barFill.className = 'mdb-pill-bar-fill';
                            barFill.style.width = pct + '%';
                            barFill.style.backgroundColor = item.barColor;

                            barTrack.appendChild(barFill);
                            pill.appendChild(barTrack);
                        }

                        var handleToggle = function(ev) {
                            if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
                            var now = new Date().getTime();
                            if (now - lastTapTs < 260) return;
                            lastTapTs = now;

                            logDebug('Натиснуто пігулку:', item.key, 'loggedIn=' + isTraktLoggedIn());

                            if (isTraktLoggedIn()) {
                                var prevTrakt = data.userTraktVote || '';
                                var nextTrakt = (prevTrakt === item.key) ? '' : item.key;
                                data.userTraktVote = nextTrakt;
                                syncReactionToTrakt(movie, data.mdbJson || null, nextTrakt);
                                renderSortedPills(item.key);
                            } else {
                                var prevVote = getUserLocalVote(mediaVoteKey);
                                var nextVote = (prevVote === item.key) ? '' : item.key;
                                setUserLocalVote(mediaVoteKey, nextVote);
                                logDebug('Локальний голос оновлено:', mediaVoteKey, nextVote || 'скасовано');
                                renderSortedPills(item.key);
                            }
                        };

                        pill.addEventListener('click', handleToggle);
                        if (window.$) {
                            window.$(pill).on('hover:enter', handleToggle);
                        } else {
                            pill.addEventListener('hover:enter', handleToggle);
                        }

                        pillsRow.appendChild(pill);

                        if (focusKey && focusKey === item.key && window.Lampa && Lampa.Controller && typeof Lampa.Controller.collectionFocus === 'function') {
                            try {
                                Lampa.Controller.collectionFocus(pill);
                            } catch (eFocus) {
                                /* ignore focus error */
                            }
                        }
                    })(sortedPills[i]);
                }
            };

            renderSortedPills('');
            wrapper.appendChild(pillsRow);
        }

        var ratingsRow = document.createElement('div');
        ratingsRow.className = 'mdb-ratings-row';
        var renderedRatings = 0;

        if (data.ratingsLoading) {
            var loadEl = document.createElement('div');
            loadEl.className = 'mdb-loading-badge';
            loadEl.textContent = 'Завантаження рейтингів MDBList...';
            ratingsRow.appendChild(loadEl);
            wrapper.appendChild(ratingsRow);
            return wrapper;
        }

        if (data.apiError === 'NO_KEY') {
            var hintEl = document.createElement('div');
            hintEl.className = 'mdb-hint-badge';
            hintEl.textContent = 'Вкажіть MDBList API Key у Налаштуваннях';
            ratingsRow.appendChild(hintEl);
            wrapper.appendChild(ratingsRow);
            return wrapper;
        }

        if (data.apiError) {
            var errEl = document.createElement('div');
            errEl.className = 'mdb-error-badge';
            errEl.textContent = 'MDBList Error: ' + data.apiError;
            ratingsRow.appendChild(errEl);
            wrapper.appendChild(ratingsRow);
            return wrapper;
        }

        if (data.ratings && data.ratings.length > 0) {
            var ratingMap = {};
            var rIdx;
            for (rIdx = 0; rIdx < data.ratings.length; rIdx++) {
                var rItem = data.ratings[rIdx];
                if (!rItem) continue;
                var normKey = normalizeSourceKey(rItem.source);
                if (normKey && !ratingMap[normKey]) {
                    ratingMap[normKey] = rItem;
                }
            }

            for (rIdx = 0; rIdx < PLATFORM_ORDER.length; rIdx++) {
                var srcKey = PLATFORM_ORDER[rIdx];
                if (!isPlatformEnabled(srcKey, settings)) continue;

                var ratingObj = ratingMap[srcKey];
                if (!ratingObj || ratingObj.value === null || ratingObj.value === undefined) continue;
                var numVal = Number(ratingObj.value);
                if (isNaN(numVal) || numVal <= 0) continue;

                var parts = formatRatingParts(srcKey, ratingObj);
                var badgeHtml = settings.badgeStyle === 'text_badges'
                    ? createTextBadge(srcKey)
                    : createSvgLogo(srcKey, numVal);

                var itemEl = document.createElement('div');
                itemEl.className = 'mdb-rating-item mdb-source-' + srcKey;

                var topEl = document.createElement('div');
                topEl.className = 'mdb-rating-top';

                var iconWrap = document.createElement('div');
                iconWrap.className = 'mdb-badge-icon';
                iconWrap.innerHTML = badgeHtml;

                var scoreGroup = document.createElement('div');
                scoreGroup.className = 'mdb-score-group';

                var scoreValEl = document.createElement('span');
                scoreValEl.className = 'mdb-score-val';
                scoreValEl.textContent = parts.score;

                var scoreDenomEl = document.createElement('span');
                scoreDenomEl.className = 'mdb-score-denom';
                scoreDenomEl.textContent = parts.denom;

                scoreGroup.appendChild(scoreValEl);
                scoreGroup.appendChild(scoreDenomEl);
                topEl.appendChild(iconWrap);
                topEl.appendChild(scoreGroup);
                itemEl.appendChild(topEl);

                var votesNum = Number(ratingObj.votes) || 0;
                if (votesNum > 0) {
                    var votesEl = document.createElement('div');
                    votesEl.className = 'mdb-votes-sub';
                    votesEl.textContent = formatVotesText(votesNum);
                    itemEl.appendChild(votesEl);
                }

                ratingsRow.appendChild(itemEl);
                renderedRatings++;
            }

            logDebug('Відображено іконок рейтингів:', renderedRatings);
            if (renderedRatings > 0) {
                wrapper.appendChild(ratingsRow);
            }
        }

        if (wrapper.children.length === 0) {
            return null;
        }
        return wrapper;
    }

    function resolveRenderRoot(e) {
        var node = null;
        if (e && e.object && e.object.activity && typeof e.object.activity.render === 'function') {
            node = e.object.activity.render();
        } else if (e && e.object && typeof e.object.render === 'function') {
            node = e.object.render();
        } else if (window.Lampa && Lampa.Activity && typeof Lampa.Activity.active === 'function') {
            var active = Lampa.Activity.active();
            if (active && active.activity && typeof active.activity.render === 'function') {
                node = active.activity.render();
            }
        }
        if (!node) return null;
        var el = node.jquery ? node[0] : node;
        return (el && el.querySelector) ? el : null;
    }

    function hideDefaultCardRates(rootEl) {
        if (!rootEl || !rootEl.querySelectorAll) return;

        if (window.$) {
            window.$(rootEl).find('.full-start__rate-line, .full-start-new__rate-line, .full-start__reactions, .full-start-new__reactions').hide();
        }

        var defaultNodes = rootEl.querySelectorAll('.full-start__rate-line, .full-start-new__rate-line, .full-start__reactions, .full-start-new__reactions');
        var i;
        for (i = 0; i < defaultNodes.length; i++) {
            defaultNodes[i].style.display = 'none';
        }
    }

    function renderIntoCard(rootEl, movie, data) {
        if (!rootEl || !rootEl.querySelector) {
            logDebug('Кореневий DOM елемент картки не знайдено');
            return false;
        }

        var settings = getSettings();
        hideDefaultCardRates(rootEl);
        applyCardTypographyAndButtonStyles(rootEl, settings);

        var oldWrappers = rootEl.querySelectorAll('.mdb-reactions-wrapper');
        var i;
        for (i = 0; i < oldWrappers.length; i++) {
            if (oldWrappers[i].parentNode) {
                oldWrappers[i].parentNode.removeChild(oldWrappers[i]);
            }
        }

        var wrapper = buildWrapperElement(data, movie, settings);
        if (wrapper) {
            var reactionsTarget = rootEl.querySelector('.full-start__reactions, .full-start-new__reactions');
            if (reactionsTarget && reactionsTarget.parentNode) {
                reactionsTarget.parentNode.insertBefore(wrapper, reactionsTarget);
            } else {
                var buttonsTarget = rootEl.querySelector('.full-start__buttons, .full-start-new__buttons');
                if (buttonsTarget && buttonsTarget.parentNode) {
                    buttonsTarget.parentNode.insertBefore(wrapper, buttonsTarget);
                } else {
                    var bodyTarget = rootEl.querySelector('.full-start__body, .full-start-new__body, .full-start-new__left, .full-start');
                    if (bodyTarget) {
                        bodyTarget.appendChild(wrapper);
                    } else {
                        rootEl.appendChild(wrapper);
                    }
                }
            }
        }

        syncWatchedActionButton(rootEl, movie, data);
        return true;
    }

    function registerSettings() {
        if (!window.Lampa || !Lampa.SettingsApi) return;

        var sidebarIcon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>' +
            '</svg>';

        Lampa.SettingsApi.addComponent({
            component: PLUGIN_COMPONENT,
            name: 'Trakt & Рейтинги',
            icon: sidebarIcon
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'trakt_auth_btn',
                type: 'button'
            },
            field: {
                name: isTraktLoggedIn()
                    ? 'Вийти з Trakt (Підключено)'
                    : 'Увійти в акаунт Trakt (Код активації)',
                description: 'Двостороння синхронізація реакцій, переглядів та скробблінг із профілем Trakt'
            },
            onChange: function() {
                if (isTraktLoggedIn()) {
                    clearTraktTokens();
                    updateAuthButtonText();
                    if (window.Lampa && Lampa.Noty) {
                        Lampa.Noty.show('Ви вийшли з акаунта Trakt');
                    }
                } else {
                    startTraktDeviceAuth();
                }
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'trakt_client_id',
                type: 'input',
                values: '',
                placeholder: 'Вставте ваш Trakt Client ID',
                default: ''
            },
            field: {
                name: 'Trakt Client ID',
                description: 'Client ID застосунку (PKCE) з developer.trakt.tv для реакцій та авторизації'
            },
            onChange: function() {
                clearPluginCache(true);
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdblist_api_key',
                type: 'input',
                values: '',
                placeholder: 'Вставте ваш MDBList API Key',
                default: ''
            },
            field: {
                name: 'MDBList API Key',
                description: 'Ключ API з сайту mdblist.com для відображення рейтингів 7 платформ'
            },
            onChange: function() {
                clearPluginCache(true);
            }
        });

        if (window.Lampa && Lampa.Settings && Lampa.Settings.listener) {
            Lampa.Settings.listener.follow('open', function(ev) {
                if (ev && ev.name === PLUGIN_COMPONENT) {
                    window.setTimeout(updateAuthButtonText, 50);
                }
            });
        }

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_title_size',
                type: 'select',
                values: {
                    'default': 'Стандартний (Lampa)',
                    medium: 'Середній',
                    compact: 'Компактний',
                    small: 'Малий'
                },
                default: 'default'
            },
            field: {
                name: 'Розмір назви фільму',
                description: 'Масштаб заголовка фільму або серіалу на картці'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_tagline_size',
                type: 'select',
                values: {
                    'default': 'Стандартний (Lampa)',
                    compact: 'Компактний',
                    small: 'Малий',
                    hidden: 'Приховати слоган'
                },
                default: 'compact'
            },
            field: {
                name: 'Розмір слогану (підзаголовка)',
                description: 'Розмір або приховування слогану під назвою фільму'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_buttons_size',
                type: 'select',
                values: {
                    'default': 'Стандартний (Lampa)',
                    compact: 'Компактний',
                    small: 'Малий'
                },
                default: 'default'
            },
            field: {
                name: 'Розмір нижніх кнопок дій',
                description: 'Пропорційний масштаб кнопок дій під блоком рейтингів'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_desc_size',
                type: 'select',
                values: {
                    'default': 'Стандартний (Lampa)',
                    compact: 'Компактний',
                    small: 'Малий',
                    hidden: 'Приховати опис'
                },
                default: 'default'
            },
            field: {
                name: 'Розмір опису (сюжету) фільму',
                description: 'Розмір або приховування тексту опису на сторінці фільму'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_pill_style',
                type: 'select',
                values: {
                    glass: 'Темне скло (стандартний стиль Lampa)',
                    solid: 'Контрастний темний',
                    outline: 'Мінімалістичний контур',
                    compact: 'Компактний'
                },
                default: 'glass'
            },
            field: {
                name: 'Стиль капсул реакцій',
                description: 'Зовнішній вигляд кнопок емодзі-реакцій на сторінці фільму'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_badge_style',
                type: 'select',
                values: {
                    original: 'Оригінальні логотипи',
                    monochrome: 'Монохромний',
                    text_badges: 'Текстові плашки'
                },
                default: 'original'
            },
            field: {
                name: 'Стиль іконок та бейджів рейтингів',
                description: 'Формат відображення логотипів рейтингів платформ'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_scale',
                type: 'select',
                values: {
                    '0.85': 'Малий',
                    '1.0': 'Стандартний',
                    '1.15': 'Великий'
                },
                default: '1.0'
            },
            field: {
                name: 'Розмір блоку',
                description: 'Загальний масштаб блоку реакцій та рейтингів'
            }
        });

        var toggles = new Array(
            { key: 'trakt_auto_scrobble', title: 'Автоматичний скробблінг у плеєрі' },
            { key: 'trakt_show_watched', title: 'Показувати бейдж «Переглянуто»' },
            { key: 'trakt_sync_watchlist', title: 'Синхронізувати закладки з Trakt Watchlist' },
            { key: 'trakt_show_recs', title: 'Полиця «Рекомендовано Trakt» на головній' },
            { key: 'mdb_use_png_emojis', title: 'Глянцеві 3D-іконки емодзі' },
            { key: 'mdb_emoji_glow', title: 'Кольорове світіння емодзі' },
            { key: 'mdb_emoji_anim', title: 'Анімація емодзі при наведенні' },
            { key: 'mdb_emoji_bar', title: 'Смужка відсотків у капсулах' },
            { key: 'mdb_show_pills', title: 'Показувати реакції (5 емодзі)' },
            { key: 'mdb_show_imdb', title: 'Показувати IMDb' },
            { key: 'mdb_show_trakt', title: 'Показувати Trakt' },
            { key: 'mdb_show_tmdb', title: 'Показувати TMDB' },
            { key: 'mdb_show_letterboxd', title: 'Показувати Letterboxd' },
            { key: 'mdb_show_tomatoes', title: 'Показувати Rotten Tomatoes' },
            { key: 'mdb_show_popcorn', title: 'Показувати Popcornmeter' },
            { key: 'mdb_show_metacritic', title: 'Показувати Metacritic' }
        );

        var i;
        for (i = 0; i < toggles.length; i++) {
            Lampa.SettingsApi.addParam({
                component: PLUGIN_COMPONENT,
                param: {
                    name: toggles[i].key,
                    type: 'trigger',
                    default: true
                },
                field: {
                    name: toggles[i].title
                }
            });
        }

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'trakt_sync_watchlist_btn',
                type: 'button'
            },
            field: {
                name: 'Синхронізувати Watchlist зараз',
                description: 'Двостороння синхронізація закладок Lampa та Trakt Watchlist'
            },
            onChange: function() {
                if (!isTraktLoggedIn()) {
                    if (window.Lampa && Lampa.Noty) {
                        Lampa.Noty.show('Спочатку увійдіть у Trakt');
                    }
                    return;
                }
                runTwoWayWatchlistSync(true);
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_clear_cache_btn',
                type: 'button'
            },
            field: {
                name: 'Очистити кеш рейтингів',
                description: 'Видалити збережені рейтинги та реакції для повторного завантаження'
            },
            onChange: function() {
                clearPluginCache(false);
            }
        });
    }

    function registerManifest() {
        if (!window.Lampa || !Lampa.Manifest || !Lampa.Manifest.plugins) return;
        if (typeof Lampa.Manifest.plugins.push === 'function') {
            Lampa.Manifest.plugins.push({
                type: 'other',
                version: '1.4.1',
                name: 'Trakt & Рейтинги',
                description: 'Синхронізація Trakt, скробблінг 80%, Watchlist, рекомендації, живі реакції та рейтинги з 7 платформ',
                component: PLUGIN_COMPONENT
            });
        }
    }

    function attachFullListener() {
        if (!window.Lampa || !Lampa.Listener) return;

        Lampa.Listener.follow('full', function(e) {
            if (!e || e.type !== 'complite') return;
            if (!e.data || !e.data.movie || !e.data.movie.id) return;

            var movie = e.data.movie;
            var type = movie.first_air_date ? 'show' : 'movie';
            var cacheKey = CACHE_PREFIX + type + '_' + movie.id;

            logDebug('Подія full:complite для:', movie.id, movie.title || movie.name || '');

            var cachedData = readCache(cacheKey);
            var keys = getApiKeys();
            var settings = getSettings();

            window.setTimeout(function() {
                var rootEl = resolveRenderRoot(e);
                logDebug('Перевірка DOM через 150мс, rootEl знайдено:', Boolean(rootEl));

                if (rootEl) {
                    hideDefaultCardRates(rootEl);
                    applyCardTypographyAndButtonStyles(rootEl, settings);
                }

                if (cachedData) {
                    logDebug('Миттєвий рендер з кешу v13:', cacheKey);
                    var cachedRenderState = {
                        ratings: cachedData.ratings,
                        reactions: cachedData.reactions,
                        mdbJson: cachedData.mdbJson || null,
                        apiError: cachedData.apiError || '',
                        ratingsLoading: false,
                        userTraktVote: '',
                        initialTraktVote: '',
                        watchedStatus: null
                    };
                    if (rootEl) renderIntoCard(rootEl, movie, cachedRenderState);

                    if (isTraktLoggedIn() && keys.traktClientId) {
                        fetchUserTraktRatingForMedia(movie, cachedRenderState.mdbJson, function(userReactionKey) {
                            cachedRenderState.userTraktVote = userReactionKey;
                            cachedRenderState.initialTraktVote = userReactionKey;
                            var targetRoot = resolveRenderRoot(e) || rootEl;
                            if (targetRoot) renderIntoCard(targetRoot, movie, cachedRenderState);
                        });

                        fetchUserWatchedStatusForMedia(movie, cachedRenderState.mdbJson, function(watchedStatus) {
                            cachedRenderState.watchedStatus = watchedStatus;
                            var targetRoot = resolveRenderRoot(e) || rootEl;
                            if (targetRoot) renderIntoCard(targetRoot, movie, cachedRenderState);
                        });
                    }
                    return;
                }

                var state = {
                    ratings: new Array(),
                    reactions: keys.traktClientId
                        ? createEmptyReactions('Завантаження оцінок Trakt...', true)
                        : createEmptyReactions('Вкажіть Trakt Client ID у Налаштуваннях', false),
                    mdbJson: null,
                    apiError: keys.mdblistKey ? '' : 'NO_KEY',
                    ratingsLoading: Boolean(keys.mdblistKey),
                    userTraktVote: '',
                    initialTraktVote: '',
                    watchedStatus: null
                };

                var mdblistDone = !keys.mdblistKey;
                var traktDone = !keys.traktClientId;

                var syncCardAndCache = function() {
                    var currentRoot = resolveRenderRoot(e) || rootEl;
                    if (currentRoot) {
                        renderIntoCard(currentRoot, movie, state);
                    }
                    if (mdblistDone && traktDone) {
                        writeCache(cacheKey, {
                            ratings: state.ratings,
                            reactions: state.reactions,
                            mdbJson: state.mdbJson,
                            apiError: state.apiError
                        });
                    }
                };

                syncCardAndCache();

                fetchMdblistViaChain(movie, keys.mdblistKey, function(errSummary, json) {
                    state.ratingsLoading = false;
                    mdblistDone = true;

                    if (errSummary === 'NO_KEY') {
                        state.apiError = 'NO_KEY';
                    } else if (errSummary || !json || !hasValidPositiveRatings(json.ratings)) {
                        state.apiError = errSummary || 'Порожній масив ratings';
                        logDebug('MDBList API помилка:', state.apiError);
                    } else {
                        state.apiError = '';
                        state.ratings = json.ratings;
                        state.mdbJson = json;
                        logDebug('MDBList API успішно повернув рейтингів:', json.ratings.length);
                    }

                    syncCardAndCache();

                    if (keys.traktClientId) {
                        fetchTraktRatings(movie, json, keys.traktClientId, function(traktReactions) {
                            traktDone = true;
                            state.reactions = traktReactions;
                            syncCardAndCache();
                        });

                        if (isTraktLoggedIn()) {
                            fetchUserTraktRatingForMedia(movie, json, function(userReactionKey) {
                                state.userTraktVote = userReactionKey;
                                state.initialTraktVote = userReactionKey;
                                syncCardAndCache();
                            });

                            fetchUserWatchedStatusForMedia(movie, json, function(watchedStatus) {
                                state.watchedStatus = watchedStatus;
                                syncCardAndCache();
                            });
                        }
                    }
                });
            }, 150);
        });

        logDebug('Слухач подій full підключено');
    }

    function initPlugin() {
        if (initialized) return;
        initialized = true;

        logDebug('Ініціалізація плагіна Trakt & Рейтинги');
        injectStyles();
        registerManifest();
        registerSettings();
        attachFullListener();
        attachPlayerScrobbler();
        attachWatchlistListeners();
        registerTraktRecommendationsRow();
    }

    if (window.appready) {
        initPlugin();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function(e) {
            if (e && e.type === 'ready') {
                initPlugin();
            }
        });
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            if (window.Lampa) initPlugin();
        });
    }
})();
