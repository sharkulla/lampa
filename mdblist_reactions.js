(function() {
    'use strict';

    var CACHE_PREFIX = 'mdblist_v13_';
    var OLD_CACHE_PREFIXES = new Array('mdblist_v7_', 'mdblist_v8_', 'mdblist_v9_', 'mdblist_v10_', 'mdblist_v11_', 'mdblist_v12_');
    var VOTE_PREFIX = 'mdblist_user_vote_';
    var CACHE_TTL_MINUTES = 1440;
    var STYLE_ID = 'mdblist-reactions-plugin-styles';
    var PLUGIN_COMPONENT = 'mdblist_reactions';
    var initialized = false;

    var REACTION_DEFS = new Array(
        { key: 'masterpiece', emoji: '🔥', label: 'Шедевр', order: 0 },
        { key: 'worth', emoji: '👍', label: 'Варто глянути', order: 1 },
        { key: 'once', emoji: '🤔', label: 'На один раз', order: 2 },
        { key: 'boring', emoji: '😴', label: 'Нудно', order: 3 },
        { key: 'weak', emoji: '💩', label: 'Слабко', order: 4 }
    );

    var PLATFORM_ORDER = new Array(
        'imdb',
        'trakt',
        'tmdb',
        'letterboxd',
        'tomatoes',
        'popcorn',
        'metacritic',
        'rogerebert'
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
            showPills: getStorageBoolTrueDefault('mdb_show_pills'),
            showImdb: getStorageBoolTrueDefault('mdb_show_imdb'),
            showTrakt: getStorageBoolTrueDefault('mdb_show_trakt'),
            showTmdb: getStorageBoolTrueDefault('mdb_show_tmdb'),
            showLetterboxd: getStorageBoolTrueDefault('mdb_show_letterboxd'),
            showTomatoes: getStorageBoolTrueDefault('mdb_show_tomatoes'),
            showPopcorn: getStorageBoolTrueDefault('mdb_show_popcorn'),
            showMetacritic: getStorageBoolTrueDefault('mdb_show_metacritic'),
            showRogerebert: getStorageBoolTrueDefault('mdb_show_rogerebert')
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
        if (sourceKey === 'rogerebert') return settings.showRogerebert;
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
        logDebug('Кеш очищено, видалено записів:', removed);
        if (!silent && window.Lampa && Lampa.Noty) {
            Lampa.Noty.show('Кеш MDBList очищено');
        }
        return removed;
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
        if (s === 'ebert') return 'rogerebert';
        return s;
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

        if (sourceKey === 'rogerebert') {
            return '<svg class="mdb-svg" viewBox="0 0 48 48" width="28" height="28">' +
                '<path d="M12 22 H17 V40 H12 C10.3 40 9 38.7 9 37 V25 C9 23.3 10.3 22 12 22 Z" fill="#FFFFFF"/>' +
                '<path d="M20 21 L25.5 9.5 C26.3 7.8 28.4 7.2 30 8.1 C31.4 8.9 32 10.6 31.4 12.1 L29.2 18 H37.5 C39.8 18 41.5 20.1 41.1 22.4 L38.9 36.4 C38.5 38.5 36.7 40 34.6 40 H20 V21 Z" fill="#FFFFFF"/>' +
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
            metacritic: { label: 'MC', bg: '#D4AF37', fg: '#111111' },
            rogerebert: { label: 'EBERT', bg: '#3C404B', fg: '#FFFFFF' }
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
        if (sourceKey === 'rogerebert') {
            return { score: val.toFixed(1), denom: '/4' };
        }
        return { score: String(val), denom: '' };
    }

    function getUserVote(mediaVoteKey) {
        if (!window.Lampa || !Lampa.Storage) return '';
        return getStorageStr(VOTE_PREFIX + mediaVoteKey, '');
    }

    function setUserVote(mediaVoteKey, reactionKey) {
        if (!window.Lampa || !Lampa.Storage) return;
        if (reactionKey) {
            Lampa.Storage.set(VOTE_PREFIX + mediaVoteKey, reactionKey);
        } else {
            Lampa.Storage.remove(VOTE_PREFIX + mediaVoteKey);
        }
    }

    function buildSortedPillsList(reactions, currentVote) {
        var list = new Array();
        var i;
        for (i = 0; i < REACTION_DEFS.length; i++) {
            var def = REACTION_DEFS[i];
            var baseCount = Number(reactions[def.key]) || 0;
            var isSelected = (currentVote === def.key);
            list.push({
                key: def.key,
                emoji: def.emoji,
                label: def.label,
                order: def.order,
                count: baseCount + (isSelected ? 1 : 0),
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
            '  gap: 0.45em;' +
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

            '.mdb-pill-emoji {' +
            '  font-size: 1.18em;' +
            '  line-height: 1;' +
            '}' +
            '.mdb-pill-count {' +
            '  font-variant-numeric: tabular-nums;' +
            '  letter-spacing: 0.01em;' +
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
            ' mdb-badges-' + settings.badgeStyle + ' ' + scaleClass;

        if (settings.showPills && data.reactions) {
            var pillsRow = document.createElement('div');
            pillsRow.className = 'mdb-pills-row lampa-pill-row';
            var lastTapTs = 0;

            var renderSortedPills = function(focusKey) {
                while (pillsRow.firstChild) {
                    pillsRow.removeChild(pillsRow.firstChild);
                }

                var currentVote = getUserVote(mediaVoteKey);
                var sortedPills = buildSortedPillsList(data.reactions, currentVote);
                var hintSuffix = data.reactions.hintText ? (' (' + data.reactions.hintText + ')') : '';
                var i;

                for (i = 0; i < sortedPills.length; i++) {
                    (function(item) {
                        var pill = document.createElement('div');
                        pill.className = 'mdb-pill selector' + (item.isSelected ? ' active' : '');
                        pill.setAttribute('data-reaction-key', item.key);

                        var tooltip = document.createElement('span');
                        tooltip.className = 'mdb-pill-tooltip';
                        tooltip.textContent = item.label + hintSuffix;

                        var emojiEl = document.createElement('span');
                        emojiEl.className = 'mdb-pill-emoji';
                        emojiEl.textContent = item.emoji;

                        var countEl = document.createElement('span');
                        countEl.className = 'mdb-pill-count';
                        countEl.textContent = formatPillCount(item.count);

                        pill.appendChild(tooltip);
                        pill.appendChild(emojiEl);
                        pill.appendChild(countEl);

                        var handleToggle = function(ev) {
                            if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
                            var now = new Date().getTime();
                            if (now - lastTapTs < 260) return;
                            lastTapTs = now;

                            var prevVote = getUserVote(mediaVoteKey);
                            var nextVote = (prevVote === item.key) ? '' : item.key;
                            setUserVote(mediaVoteKey, nextVote);
                            logDebug('Голос користувача оновлено:', mediaVoteKey, nextVote || 'скасовано');
                            renderSortedPills(item.key);
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

    function renderIntoCard(rootEl, movie, data) {
        if (!rootEl || !rootEl.querySelector) {
            logDebug('Кореневий DOM елемент картки не знайдено');
            return false;
        }

        var existingReactions = rootEl.querySelectorAll('.full-start__reactions, .full-start-new__reactions');
        var i;
        for (i = 0; i < existingReactions.length; i++) {
            existingReactions[i].style.display = 'none';
        }

        var oldWrappers = rootEl.querySelectorAll('.mdb-reactions-wrapper');
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
            name: 'MDBList Реакції',
            icon: sidebarIcon
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
                description: 'Ключ API з сайту mdblist.com для відображення рейтингів 8 платформ'
            },
            onChange: function() {
                clearPluginCache(true);
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
                description: 'Client ID застосунку trakt.tv для точних реакцій за оцінками 1–10'
            },
            onChange: function() {
                clearPluginCache(true);
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
            { key: 'mdb_show_pills', title: 'Показувати реакції (5 емодзі)' },
            { key: 'mdb_show_imdb', title: 'Показувати IMDb' },
            { key: 'mdb_show_trakt', title: 'Показувати Trakt' },
            { key: 'mdb_show_tmdb', title: 'Показувати TMDB' },
            { key: 'mdb_show_letterboxd', title: 'Показувати Letterboxd' },
            { key: 'mdb_show_tomatoes', title: 'Показувати Rotten Tomatoes' },
            { key: 'mdb_show_popcorn', title: 'Показувати Popcornmeter' },
            { key: 'mdb_show_metacritic', title: 'Показувати Metacritic' },
            { key: 'mdb_show_rogerebert', title: 'Показувати Roger Ebert' }
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
                name: 'Очистити кеш MDBList',
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
                version: '1.1.0',
                name: 'MDBList Реакції та Рейтинги',
                description: 'Реакції за оцінками Trakt API v2 та панель рейтингів з 8 платформ через MDBList API',
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

                if (cachedData) {
                    logDebug('Миттєвий рендер з кешу v13:', cacheKey);
                    if (rootEl) renderIntoCard(rootEl, movie, cachedData);
                    return;
                }

                var state = {
                    ratings: new Array(),
                    reactions: keys.traktClientId
                        ? createEmptyReactions('Завантаження оцінок Trakt...', true)
                        : createEmptyReactions('Вкажіть Trakt Client ID у Налаштуваннях', false),
                    apiError: keys.mdblistKey ? '' : 'NO_KEY',
                    ratingsLoading: Boolean(keys.mdblistKey)
                };

                var mdblistDone = !keys.mdblistKey;
                var traktDone = !keys.traktClientId;

                var syncCardAndCache = function() {
                    var currentRoot = resolveRenderRoot(e) || rootEl;
                    if (currentRoot) {
                        renderIntoCard(currentRoot, movie, state);
                    }
                    if (mdblistDone && traktDone) {
                        writeCache(cacheKey, state);
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
                        logDebug('MDBList API успішно повернув рейтингів:', json.ratings.length);
                    }

                    syncCardAndCache();

                    if (keys.traktClientId) {
                        fetchTraktRatings(movie, json, keys.traktClientId, function(traktReactions) {
                            traktDone = true;
                            state.reactions = traktReactions;
                            syncCardAndCache();
                        });
                    }
                });
            }, 150);
        });

        logDebug('Слухач подій full підключено');
    }

    function initPlugin() {
        if (initialized) return;
        initialized = true;

        logDebug('Ініціалізація плагіна MDBList Реакції та Рейтинги');
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
