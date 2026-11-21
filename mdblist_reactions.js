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
    var TRAKT_SYNC_TTL_MS = 15 * 60 * 1000;
    var CACHE_TTL_MINUTES = 1440;
    var STYLE_ID = 'mdblist-reactions-plugin-styles';
    var PLUGIN_COMPONENT = 'mdblist_reactions';
    var initialized = false;
    var activePollTimer = null;

    var REACTION_DEFS = new Array(
        {
            key: 'masterpiece',
            emoji: '🔥',
            png: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/1f525.png',
            barColor: 'rgba(255, 94, 20, 0.85)',
            traktScore: 10,
            label: 'Шедевр',
            order: 0
        },
        {
            key: 'worth',
            emoji: '👍',
            png: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/1f44d.png',
            barColor: 'rgba(255, 204, 0, 0.85)',
            traktScore: 8,
            label: 'Варто глянути',
            order: 1
        },
        {
            key: 'once',
            emoji: '🤔',
            png: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/1f914.png',
            barColor: 'rgba(255, 193, 7, 0.78)',
            traktScore: 6,
            label: 'На один раз',
            order: 2
        },
        {
            key: 'boring',
            emoji: '😴',
            png: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/1f634.png',
            barColor: 'rgba(100, 149, 237, 0.85)',
            traktScore: 4,
            label: 'Нудно',
            order: 3
        },
        {
            key: 'weak',
            emoji: '💩',
            png: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/1f4a9.png',
            barColor: 'rgba(181, 115, 65, 0.85)',
            traktScore: 1,
            label: 'Слабко',
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
                        updateAuthButtonText();
                        closeAuthModal();
                        if (window.Lampa && Lampa.Noty) {
                            Lampa.Noty.show('Успішно підключено до Trakt!');
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

    function readTraktSyncMap(isShow) {
        var key = isShow ? TRAKT_SYNC_CACHE_SHOWS : TRAKT_SYNC_CACHE_MOVIES;
        try {
            if (!window.Lampa || !Lampa.Storage) return null;
            var raw = Lampa.Storage.get(key, null);
            if (!raw || !raw._ts || !raw.map) return null;
            if ((new Date().getTime() - Number(raw._ts)) < TRAKT_SYNC_TTL_MS) {
                return raw.map;
            }
            return null;
        } catch (err) {
            return null;
        }
    }

    function writeTraktSyncMap(isShow, map) {
        var key = isShow ? TRAKT_SYNC_CACHE_SHOWS : TRAKT_SYNC_CACHE_MOVIES;
        try {
            if (!window.Lampa || !Lampa.Storage) return;
            Lampa.Storage.set(key, {
                _ts: new Date().getTime(),
                map: map
            });
        } catch (err) {
            /* ignore */
        }
    }

    function updateLocalTraktSyncMap(isShow, movie, mdbJson, reactionKey) {
        var map = readTraktSyncMap(isShow);
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

        writeTraktSyncMap(isShow, map);
    }

    function lookupUserRatingInMap(map, movie, mdbJson) {
        if (!map) return 0;
        if (map['tmdb_' + movie.id]) return Number(map['tmdb_' + movie.id]);
        var traktId = (mdbJson && mdbJson.ids && mdbJson.ids.trakt) ? String(mdbJson.ids.trakt) : '';
        if (traktId && map['trakt_' + traktId]) return Number(map['trakt_' + traktId]);
        var imdbId = (mdbJson && mdbJson.ids && mdbJson.ids.imdb) || movie.imdb_id || (movie.external_ids && movie.external_ids.imdb_id) || '';
        if (imdbId && map['imdb_' + imdbId]) return Number(map['imdb_' + imdbId]);
        return 0;
    }

    function fetchUserTraktRatingForMedia(movie, mdbJson, callback) {
        var keys = getApiKeys();
        if (!isTraktLoggedIn() || !keys.traktClientId) {
            callback('');
            return;
        }

        var isShow = Boolean(movie.first_air_date);
        var cachedMap = readTraktSyncMap(isShow);
        if (cachedMap) {
            var cachedScore = lookupUserRatingInMap(cachedMap, movie, mdbJson);
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
                    writeTraktSyncMap(isShow, map);
                    var foundScore = lookupUserRatingInMap(map, movie, mdbJson);
                    callback(ratingValueToReactionKey(foundScore));
                } else {
                    callback('');
                }
            });
        });
    }

    function hasNotFoundItems(res) {
        if (!res || !res.not_found) return false;
        var nfMovies = res.not_found.movies && res.not_found.movies.length > 0;
        var nfShows = res.not_found.shows && res.not_found.shows.length > 0;
        return Boolean(nfMovies || nfShows);
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
                    if ((status === 200 || status === 201) && res && res.added && (res.added.movies > 0 || res.added.shows > 0) && !hasNotFoundItems(res)) {
                        updateLocalTraktSyncMap(isShow, movie, mdbJson, reactionKey);
                        if (window.Lampa && Lampa.Noty) {
                            Lampa.Noty.show('Оцінку збережено в Trakt!');
                        }
                    } else if (hasNotFoundItems(res)) {
                        if (window.Lampa && Lampa.Noty) {
                            Lampa.Noty.show('Помилка Trakt: не знайдено (HTTP ' + status + ')');
                        }
                    } else {
                        var errReason = (res && (res.error_description || res.error || res.message)) ? (' - ' + (res.error_description || res.error || res.message)) : '';
                        if (window.Lampa && Lampa.Noty) {
                            Lampa.Noty.show('Помилка Trakt: ' + status + errReason);
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
                    var deletedOk = (status === 200 || status === 204) && (!res || !hasNotFoundItems(res));
                    if (deletedOk && res && res.deleted && (res.deleted.movies === 0 && res.deleted.shows === 0)) {
                        deletedOk = false;
                    }
                    if (deletedOk) {
                        updateLocalTraktSyncMap(isShow, movie, mdbJson, '');
                        if (window.Lampa && Lampa.Noty) {
                            Lampa.Noty.show('Оцінку видалено з Trakt!');
                        }
                    } else {
                        var errReason = (res && (res.error_description || res.error || res.message)) ? (' - ' + (res.error_description || res.error || res.message)) : '';
                        if (window.Lampa && Lampa.Noty) {
                            Lampa.Noty.show('Помилка Trakt: ' + status + errReason);
                        }
                    }
                });
            }
        });
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
            '.mdb-pill.active {' +
            '  background: rgba(255, 255, 255, 0.26);' +
            '  border-color: #ffffff;' +
            '  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.45);' +
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
                        pill.className = 'mdb-pill lampa-pill-btn selector' + (item.isSelected ? ' active' : '');
                        pill.setAttribute('data-reaction-key', item.key);

                        var tooltip = document.createElement('span');
                        tooltip.className = 'mdb-pill-tooltip';
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

        hideDefaultCardRates(rootEl);

        var oldWrappers = rootEl.querySelectorAll('.mdb-reactions-wrapper');
        var i;
        for (i = 0; i < oldWrappers.length; i++) {
            if (oldWrappers[i].parentNode) {
                oldWrappers[i].parentNode.removeChild(oldWrappers[i]);
            }
        }

        var settings = getSettings();
        var wrapper = buildWrapperElement(data, movie, settings);
        if (!wrapper) {
            logDebug('Порожній блок wrapper');
            return false;
        }

        var reactionsTarget = rootEl.querySelector('.full-start__reactions, .full-start-new__reactions');
        if (reactionsTarget && reactionsTarget.parentNode) {
            reactionsTarget.parentNode.insertBefore(wrapper, reactionsTarget);
            return true;
        }

        var buttonsTarget = rootEl.querySelector('.full-start__buttons, .full-start-new__buttons');
        if (buttonsTarget && buttonsTarget.parentNode) {
            buttonsTarget.parentNode.insertBefore(wrapper, buttonsTarget);
            return true;
        }

        var bodyTarget = rootEl.querySelector('.full-start__body, .full-start-new__body, .full-start-new__left, .full-start');
        if (bodyTarget) {
            bodyTarget.appendChild(wrapper);
            return true;
        }

        rootEl.appendChild(wrapper);
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
                description: 'Двостороння синхронізація ваших реакцій із профілем Trakt'
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
                version: '1.2.3',
                name: 'Trakt & Рейтинги',
                description: 'Синхронізація Trakt, живі реакції та рейтинги з 7 платформ',
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

            window.setTimeout(function() {
                var rootEl = resolveRenderRoot(e);
                logDebug('Перевірка DOM через 150мс, rootEl знайдено:', Boolean(rootEl));

                if (rootEl) {
                    hideDefaultCardRates(rootEl);
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
                        initialTraktVote: ''
                    };
                    if (rootEl) renderIntoCard(rootEl, movie, cachedRenderState);

                    if (isTraktLoggedIn() && keys.traktClientId) {
                        fetchUserTraktRatingForMedia(movie, cachedRenderState.mdbJson, function(userReactionKey) {
                            cachedRenderState.userTraktVote = userReactionKey;
                            cachedRenderState.initialTraktVote = userReactionKey;
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
                    initialTraktVote: ''
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
