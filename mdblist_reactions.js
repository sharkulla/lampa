(function() {
    'use strict';

    var CACHE_PREFIX = 'mdblist_v13_';
    var OLD_CACHE_PREFIXES = new Array('mdblist_v7_', 'mdblist_v8_', 'mdblist_v9_', 'mdblist_v10_', 'mdblist_v11_', 'mdblist_v12_');
    var VOTE_PREFIX = 'mdblist_user_vote_';
    var TRAKT_TOKEN_KEY = 'trakt_access_token';
    var TRAKT_REFRESH_KEY = 'trakt_refresh_token';
    var TRAKT_EXPIRES_KEY = 'trakt_token_expires';
    var TRAKT_EXPIRES_ALT_KEY = 'trakt_expires_at';
    var TRAKT_USER_CACHE_KEY = 'trakt_user_cache';
    var TRAKT_SYNC_CACHE_MOVIES = 'trakt_sync_ratings_movies_v1';
    var TRAKT_SYNC_CACHE_SHOWS = 'trakt_sync_ratings_shows_v1';
    var TRAKT_WATCHED_CACHE_MOVIES = 'trakt_watched_movies_v1';
    var TRAKT_WATCHED_CACHE_SHOWS = 'trakt_watched_shows_v1';
    var TRAKT_PROFILE_STATS_CACHE_KEY = 'trakt_profile_stats_v2';
    var TRAKT_SYNC_TTL_MS = 15 * 60 * 1000;
    var TRAKT_PROFILE_STATS_TTL_MS = 30 * 60 * 1000;
    var CACHE_TTL_MINUTES = 1440;
    var STYLE_ID = 'mdblist-reactions-plugin-styles';
    var PLUGIN_COMPONENT = 'mdblist_reactions';
    var BOOKMARKS_ROW_NAME = 'mdb_bookmarks_row';
    var BOOKMARKS_FULL_COMPONENT = 'mdb_bookmarks_full';
    var initialized = false;
    var activePollTimer = null;
    var watchlistSyncLock = false;
    var historyImportInProgress = false;
    var authButtonFieldRef = null;
    var lastBookmarksShelfSignature = '';
    var lastWatchlistPush = {
        key: '',
        ts: 0
    };

    var lastRenderedCard = {
        rootEl: null,
        movie: null,
        data: null
    };

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

    var EMOJI_PACK_BASES = {
        apple: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/',
        google: 'https://cdn.jsdelivr.net/npm/emoji-datasource-google@15.1.2/img/google/64/',
        twitter: 'https://cdn.jsdelivr.net/npm/emoji-datasource-twitter@15.1.2/img/twitter/64/',
        facebook: 'https://cdn.jsdelivr.net/npm/emoji-datasource-facebook@15.1.2/img/facebook/64/'
    };

    var REACTION_DEFS = new Array(
        {
            key: 'masterpiece',
            emoji: '🔥',
            hex: '1f525',
            barColor: 'rgba(255, 94, 20, 0.85)',
            traktScore: 10,
            labelUk: 'Шедевр (5★ Trakt)',
            labelRu: 'Шедевр (5★ Trakt)',
            order: 0
        },
        {
            key: 'worth',
            emoji: '👍',
            hex: '1f44d',
            barColor: 'rgba(255, 204, 0, 0.85)',
            traktScore: 8,
            labelUk: 'Варто глянути (4★ Trakt)',
            labelRu: 'Стоит посмотреть (4★ Trakt)',
            order: 1
        },
        {
            key: 'once',
            emoji: '🤔',
            hex: '1f914',
            barColor: 'rgba(255, 193, 7, 0.78)',
            traktScore: 6,
            labelUk: 'На один раз (3★ Trakt)',
            labelRu: 'На один раз (3★ Trakt)',
            order: 2
        },
        {
            key: 'boring',
            emoji: '😴',
            hex: '1f634',
            barColor: 'rgba(100, 149, 237, 0.85)',
            traktScore: 4,
            labelUk: 'Нудно (2★ Trakt)',
            labelRu: 'Скучно (2★ Trakt)',
            order: 3
        },
        {
            key: 'weak',
            emoji: '💩',
            hex: '1f4a9',
            barColor: 'rgba(181, 115, 65, 0.85)',
            traktScore: 2,
            labelUk: 'Слабко (1★ Trakt)',
            labelRu: 'Слабо (1★ Trakt)',
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

    function getStorageStr(key, defaultVal) {
        if (!window.Lampa || !Lampa.Storage) return defaultVal;
        var val = Lampa.Storage.get(key, defaultVal);
        return (val === undefined || val === null || val === '') ? defaultVal : String(val);
    }

    function safeStorageRemove(key) {
        try {
            if (window.Lampa && Lampa.Storage) {
                if (typeof Lampa.Storage.set === 'function') {
                    Lampa.Storage.set(key, '');
                }
                if (typeof Lampa.Storage.remove === 'function') {
                    Lampa.Storage.remove(key);
                }
            }
            if (window.localStorage && typeof window.localStorage.removeItem === 'function') {
                window.localStorage.removeItem(key);
            }
        } catch (err) {
            /* ignore storage errors */
        }
    }

    function isRuLang() {
        if (!window.Lampa || !Lampa.Storage) return false;
        return (Lampa.Storage.get('language', 'uk') === 'ru');
    }

    function loc(ukText, ruText) {
        return isRuLang() ? ruText : ukText;
    }

    function getReactionLabel(def) {
        return isRuLang() ? def.labelRu : def.labelUk;
    }

    function getScaleOptions() {
        var std = loc('100% (Стандарт)', '100% (Стандарт)');
        return {
            '0.5': '50%',
            '0.6': '60%',
            '0.7': '70%',
            '0.8': '80%',
            '0.9': '90%',
            '1.0': std,
            '1.1': '110%',
            '1.2': '120%',
            '1.3': '130%',
            '1.4': '140%',
            '1.5': '150%',
            '1.6': '160%',
            '1.7': '170%',
            '1.8': '180%'
        };
    }

    function getEmojiPackOptions() {
        return {
            apple: loc('Apple iOS (Глянцевий 3D)', 'Apple iOS (Глянцевый 3D)'),
            google: loc('Google Noto (Android Стиль)', 'Google Noto (Android Стиль)'),
            twitter: loc('Twemoji (Плоский векторний)', 'Twemoji (Плоский векторный)'),
            facebook: loc('Facebook (Насичений глянець)', 'Facebook (Насыщенный глянец)'),
            unicode: loc('Системні емодзі (Шрифтові)', 'Системные эмодзи (Шрифтовые)')
        };
    }

    function getRatingsFormatOptions() {
        return {
            full: loc('Повний (Бал + % + кількість голосів 100K)', 'Полный (Балл + % + количество голосов 100K)'),
            no_votes: loc('Без кількості голосів (Тільки бал і %)', 'Без количества голосов (Только балл и %)'),
            clean_numbers: loc('Тільки чисті цифри (Без % і без голосів)', 'Только чистые цифры (Без % и без голосов)'),
            scale_10: loc('Єдина 10-бальна шкала (Усе у форматі X.X)', 'Единая 10-балльная шкала (Всё в формате X.X)'),
            minimal_row: loc('Мінімалізм без рамок (Чисті цифри в рядок)', 'Минимализм без рамок (Чистые цифры в строку)')
        };
    }

    function getPillStyleOptions() {
        return {
            glass: loc('Темне скло (стандартний стиль Lampa)', 'Тёмное стекло (стандартный стиль Lampa)'),
            solid: loc('Контрастний темний', 'Контрастный тёмный'),
            outline: loc('Мінімалістичний контур', 'Минималистичный контур'),
            compact: loc('Компактний', 'Компактный'),
            neon: loc('Неонове скло (Кольоровий контур)', 'Неоновое стекло (Цветной контур)'),
            graphite: loc('Матовий графіт (Apple TV+)', 'Матовый графит (Apple TV+)'),
            crystal: loc('Кристал (Прозорий мінімалізм)', 'Кристалл (Прозрачный минимализм)'),
            imax: loc('Кінотеатр IMAX (Темно-синій акцент)', 'Кинотеатр IMAX (Тёмно-синий акцент)'),
            gold: loc('Золотий преміум (Оскар)', 'Золотой премиум (Оскар)'),
            contrast: loc('Контрастний монохром', 'Контрастный монохром'),
            gradient: loc('М\'який градієнт (Динамічний)', 'Мягкий градиент (Динамический)')
        };
    }

    function getRatingsStyleOptions() {
        return {
            clean: loc('Чистий без рамок (стандартний)', 'Чистый без рамок (стандартный)'),
            glass: loc('Темне скло (стандартний стиль Lampa)', 'Тёмное стекло (стандартный стиль Lampa)'),
            solid: loc('Контрастний темний', 'Контрастный тёмный'),
            outline: loc('Мінімалістичний контур', 'Минималистичный контур'),
            compact: loc('Компактний', 'Компактный'),
            neon: loc('Неонове скло (Кольоровий контур)', 'Неоновое стекло (Цветной контур)'),
            graphite: loc('Матовий графіт (Apple TV+)', 'Матовый графит (Apple TV+)'),
            crystal: loc('Кристал (Прозорий мінімалізм)', 'Кристалл (Прозрачный минимализм)'),
            imax: loc('Кінотеатр IMAX (Темно-синій акцент)', 'Кинотеатр IMAX (Тёмно-синий акцент)'),
            gold: loc('Золотий преміум (Оскар)', 'Золотой премиум (Оскар)'),
            contrast: loc('Контрастний монохром', 'Контрастный монохром'),
            gradient: loc('М\'який градієнт (Динамічний)', 'Мягкий градиент (Динамический)')
        };
    }

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

    function cleanupLegacyStorageKeys() {
        var legacyKeys = new Array(
            'mdb_title_size',
            'mdb_tagline_size',
            'mdb_buttons_size',
            'mdb_desc_size',
            'trakt_profile_stats_v1',
            'trakt_recs_cache_v1',
            'trakt_recs_cache_v2',
            'trakt_watchlist_row_v1'
        );
        var i;
        for (i = 0; i < legacyKeys.length; i++) {
            safeStorageRemove(legacyKeys[i]);
        }
    }

    function getStorageBoolTrueDefault(key) {
        if (!window.Lampa || !Lampa.Storage) return true;
        var val = Lampa.Storage.get(key, true);
        if (val === false || val === 'false' || val === 0 || val === '0') {
            return false;
        }
        return true;
    }

    function getScaleValue(key) {
        var raw = parseFloat(getStorageStr(key, '1.0'));
        if (isNaN(raw) || raw < 0.5 || raw > 1.8) {
            return '1.0';
        }
        return raw.toFixed(1);
    }

    function getApiKeys() {
        return {
            mdblistKey: trimStr(getStorageStr('mdblist_api_key', '')),
            traktClientId: trimStr(getStorageStr('trakt_client_id', ''))
        };
    }

    function getResolvedEmojiPack() {
        var pack = getStorageStr('mdb_emoji_pack', '');
        if (pack && (pack === 'unicode' || EMOJI_PACK_BASES[pack])) {
            return pack;
        }
        if (!getStorageBoolTrueDefault('mdb_use_png_emojis')) {
            return 'unicode';
        }
        return 'apple';
    }

    function getSettings() {
        return {
            pillStyle: getStorageStr('mdb_pill_style', 'glass'),
            ratingsStyle: getStorageStr('mdb_ratings_style', 'clean'),
            ratingsFormat: getStorageStr('mdb_ratings_format', 'full'),
            badgeStyle: getStorageStr('mdb_badge_style', 'original'),
            emojiPack: getResolvedEmojiPack(),
            scaleBadges: getScaleValue('mdb_scale_badges'),
            scalePills: getScaleValue('mdb_scale_pills'),
            scaleRatings: getScaleValue('mdb_scale_ratings'),
            autoScrobble: getStorageBoolTrueDefault('trakt_auto_scrobble'),
            showWatchedBadge: getStorageBoolTrueDefault('trakt_show_watched'),
            showAwards: getStorageBoolTrueDefault('mdb_show_awards'),
            syncWatchlist: getStorageBoolTrueDefault('trakt_sync_watchlist'),
            showBookmarksRow: getStorageBoolTrueDefault('mdb_show_bookmarks_row'),
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
                safeStorageRemove(cacheKey);
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
        safeStorageRemove(TRAKT_SYNC_CACHE_MOVIES);
        safeStorageRemove(TRAKT_SYNC_CACHE_SHOWS);
    }

    function clearTraktWatchedCache() {
        safeStorageRemove(TRAKT_WATCHED_CACHE_MOVIES);
        safeStorageRemove(TRAKT_WATCHED_CACHE_SHOWS);
    }

    function clearTraktProfileStatsCache() {
        safeStorageRemove('trakt_profile_stats_v1');
        safeStorageRemove(TRAKT_PROFILE_STATS_CACHE_KEY);
        safeStorageRemove(TRAKT_USER_CACHE_KEY);
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
                    safeStorageRemove(keysToRemove[i]);
                    removed++;
                }
            }
        } catch (err) {
            /* ignore */
        }
        clearTraktSyncCache();
        clearTraktWatchedCache();
        clearTraktProfileStatsCache();
        logDebug('Кеш очищено, видалено записів:', removed);
        if (!silent && window.Lampa && Lampa.Noty) {
            Lampa.Noty.show(loc('Кеш рейтингів очищено', 'Кэш рейтингов очищен'));
        }
        return removed;
    }

    function isTraktLoggedIn() {
        return Boolean(trimStr(getStorageStr(TRAKT_TOKEN_KEY, '')));
    }

    function clearTraktTokens() {
        var oldToken = trimStr(getStorageStr(TRAKT_TOKEN_KEY, ''));
        var keys = getApiKeys();

        if (oldToken && keys.traktClientId) {
            try {
                xhrTraktRequest('POST', 'https://api.trakt.tv/oauth/revoke', {
                    token: oldToken,
                    client_id: keys.traktClientId
                }, '', keys.traktClientId, function() {});
            } catch (eRevoke) {
                /* ignore revoke error */
            }
        }

        safeStorageRemove(TRAKT_TOKEN_KEY);
        safeStorageRemove(TRAKT_REFRESH_KEY);
        safeStorageRemove(TRAKT_EXPIRES_KEY);
        safeStorageRemove(TRAKT_EXPIRES_ALT_KEY);
        safeStorageRemove(TRAKT_USER_CACHE_KEY);
        clearTraktSyncCache();
        clearTraktWatchedCache();
        clearTraktProfileStatsCache();

        scrobbleSession.active = false;
        if (lastRenderedCard && lastRenderedCard.data) {
            lastRenderedCard.data.watchedStatus = null;
            lastRenderedCard.data.userTraktVote = '';
            lastRenderedCard.data.bakedVote = '';
        }
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
        Lampa.Storage.set(TRAKT_EXPIRES_ALT_KEY, String(expiresMs));
    }

    function getAuthButtonTitle() {
        return isTraktLoggedIn()
            ? loc('Вийти з Trakt (Підключено)', 'Выйти из Trakt (Подключено)')
            : loc('Увійти в акаунт Trakt (Код активації)', 'Войти в аккаунт Trakt (Код активации)');
    }

    function updateAuthButtonText() {
        var btnText = getAuthButtonTitle();
        if (authButtonFieldRef) {
            authButtonFieldRef.name = btnText;
        }
        try {
            var el = document.querySelector('[data-name="trakt_auth_btn"] .settings-param__name');
            if (el) {
                el.textContent = btnText;
            }
        } catch (err) {
            /* ignore */
        }
    }

    function fetchTraktProfileStats(callback) {
        var keys = getApiKeys();
        if (!isTraktLoggedIn() || !keys.traktClientId) {
            callback(null);
            return;
        }

        try {
            if (window.Lampa && Lampa.Storage) {
                var cached = Lampa.Storage.get(TRAKT_PROFILE_STATS_CACHE_KEY, null);
                if (cached && typeof cached === 'object' && cached._ts && cached.stats) {
                    var age = new Date().getTime() - Number(cached._ts);
                    var hasNonZero = (cached.stats.movies > 0 || cached.stats.episodes > 0 || cached.stats.ratings > 0);
                    var ttl = hasNonZero ? TRAKT_PROFILE_STATS_TTL_MS : 30000;
                    if (age >= 0 && age < ttl) {
                        callback(cached.stats);
                        return;
                    }
                }
            }
        } catch (eCache) {
            /* ignore */
        }

        ensureValidTraktToken(function(token) {
            if (!token) {
                callback(null);
                return;
            }

            xhrTraktRequest('GET', 'https://api.trakt.tv/users/me', null, token, keys.traktClientId, function(meStatus, meData) {
                if (meStatus !== 200 || !meData) {
                    callback(null);
                    return;
                }

                var username = meData.username || (meData.ids && meData.ids.slug) || '';

                xhrTraktRequest('GET', 'https://api.trakt.tv/users/me/stats', null, token, keys.traktClientId, function(stStatus, statsData, rawStats) {
                    logDebug('Trakt /users/me/stats status=' + stStatus, rawStats);
                    if (stStatus !== 200 || !statsData || typeof statsData !== 'object') {
                        callback(null);
                        return;
                    }

                    var moviesCount = 0;
                    var episodesCount = 0;
                    var ratingsCount = 0;

                    if (statsData.movies && typeof statsData.movies === 'object') {
                        moviesCount = parseInt(statsData.movies.watched, 10);
                        if (isNaN(moviesCount)) moviesCount = 0;
                    }

                    if (statsData.episodes && typeof statsData.episodes === 'object') {
                        episodesCount = parseInt(statsData.episodes.watched, 10);
                        if (isNaN(episodesCount)) episodesCount = 0;
                    }

                    if (statsData.ratings && typeof statsData.ratings === 'object' && statsData.ratings.total !== undefined && statsData.ratings.total !== null) {
                        ratingsCount = parseInt(statsData.ratings.total, 10);
                        if (isNaN(ratingsCount)) ratingsCount = 0;
                    } else {
                        ratingsCount = ((statsData.movies && parseInt(statsData.movies.ratings, 10)) || 0) +
                            ((statsData.shows && parseInt(statsData.shows.ratings, 10)) || 0) +
                            ((statsData.seasons && parseInt(statsData.seasons.ratings, 10)) || 0) +
                            ((statsData.episodes && parseInt(statsData.episodes.ratings, 10)) || 0);
                    }

                    var summary = {
                        username: String(username || ''),
                        movies: moviesCount,
                        episodes: episodesCount,
                        ratings: ratingsCount
                    };

                    try {
                        if (window.Lampa && Lampa.Storage) {
                            Lampa.Storage.set(TRAKT_PROFILE_STATS_CACHE_KEY, {
                                _ts: new Date().getTime(),
                                stats: summary
                            });
                        }
                    } catch (eSave) {
                        /* ignore */
                    }

                    callback(summary);
                });
            });
        });
    }

    function renderSettingsProfileStats() {
        try {
            var authBtnEl = document.querySelector('[data-name="trakt_auth_btn"]');
            if (!authBtnEl) return;

            var existingStatsEl = authBtnEl.querySelector('.mdb-trakt-profile-stats');

            if (!isTraktLoggedIn()) {
                if (existingStatsEl && existingStatsEl.parentNode) {
                    existingStatsEl.parentNode.removeChild(existingStatsEl);
                }
                return;
            }

            if (!existingStatsEl) {
                existingStatsEl = document.createElement('div');
                existingStatsEl.className = 'mdb-trakt-profile-stats';
                existingStatsEl.textContent = loc('Завантаження статистики профілю Trakt...', 'Загрузка статистики профиля Trakt...');
                authBtnEl.appendChild(existingStatsEl);
            }

            fetchTraktProfileStats(function(stats) {
                var targetBtn = document.querySelector('[data-name="trakt_auth_btn"]');
                if (!targetBtn) return;
                var targetNode = targetBtn.querySelector('.mdb-trakt-profile-stats');

                if (!isTraktLoggedIn()) {
                    if (targetNode && targetNode.parentNode) {
                        targetNode.parentNode.removeChild(targetNode);
                    }
                    return;
                }

                if (!targetNode) {
                    targetNode = document.createElement('div');
                    targetNode.className = 'mdb-trakt-profile-stats';
                    targetBtn.appendChild(targetNode);
                }

                if (stats) {
                    var profileTitle = stats.username ? ('@' + stats.username) : 'Trakt';
                    targetNode.textContent = loc('Профіль: ', 'Профиль: ') + profileTitle +
                        loc(' • Фільмів: ', ' • Фильмов: ') + stats.movies +
                        loc(' • Серій: ', ' • Серий: ') + stats.episodes +
                        loc(' • Оцінок: ', ' • Оценок: ') + stats.ratings;
                } else {
                    targetNode.textContent = loc('Статистика профілю Trakt тимчасово недоступна', 'Статистика профиля Trakt временно недоступна');
                }
            });
        } catch (err) {
            /* ignore DOM errors */
        }
    }

    function refreshSettingsAuthUi() {
        updateAuthButtonText();
        renderSettingsProfileStats();
        try {
            if (window.Lampa && Lampa.Settings && typeof Lampa.Settings.update === 'function') {
                Lampa.Settings.update();
            }
        } catch (eUpd) {
            /* ignore settings update error */
        }
        window.setTimeout(function() {
            updateAuthButtonText();
            renderSettingsProfileStats();
            try {
                var btnEl = document.querySelector('[data-name="trakt_auth_btn"]');
                if (btnEl && window.Lampa && Lampa.Controller && typeof Lampa.Controller.collectionFocus === 'function') {
                    Lampa.Controller.collectionFocus(btnEl);
                }
            } catch (eFocus) {
                /* ignore */
            }
        }, 60);
    }

    function formatPlural(n, form1, form2, form5) {
        var absN = Math.abs(Math.round(Number(n) || 0));
        var mod100 = absN % 100;
        var mod10 = absN % 10;
        if (mod100 >= 11 && mod100 <= 19) return form5;
        if (mod10 === 1) return form1;
        if (mod10 >= 2 && mod10 <= 4) return form2;
        return form5;
    }

    function parseMdblistAwards(mdbJson) {
        if (!mdbJson || typeof mdbJson !== 'object') return null;

        var rawAwards = '';
        var awardsObj = null;

        if (typeof mdbJson.awards === 'string') {
            rawAwards = trimStr(mdbJson.awards);
        } else if (mdbJson.awards && typeof mdbJson.awards === 'object') {
            awardsObj = mdbJson.awards;
            if (typeof awardsObj.text === 'string') rawAwards = trimStr(awardsObj.text);
            else if (typeof awardsObj.summary === 'string') rawAwards = trimStr(awardsObj.summary);
        }

        var oscarWins = Number(mdbJson.oscars || (awardsObj && (awardsObj.oscars_won || awardsObj.oscars)) || 0) || 0;
        var oscarNoms = Number((awardsObj && awardsObj.oscar_nominations) || 0) || 0;
        var emmyWins = Number(mdbJson.emmy || mdbJson.emmys || (awardsObj && (awardsObj.emmys_won || awardsObj.emmy)) || 0) || 0;
        var globeWins = Number(mdbJson.golden_globes || (awardsObj && (awardsObj.golden_globes_won || awardsObj.golden_globes)) || 0) || 0;
        var totalWins = Number(mdbJson.wins || (awardsObj && awardsObj.wins) || 0) || 0;

        if (rawAwards) {
            var mOscarWin = rawAwards.match(/won\s+(\d+)\s+oscar/i);
            if (mOscarWin && Number(mOscarWin[1]) > oscarWins) {
                oscarWins = Number(mOscarWin[1]);
            }

            var mOscarNom = rawAwards.match(/nominated\s+for\s+(\d+)\s+oscar/i);
            if (mOscarNom && Number(mOscarNom[1]) > oscarNoms) {
                oscarNoms = Number(mOscarNom[1]);
            }

            var mEmmyWin = rawAwards.match(/won\s+(\d+)\s+(?:primetime\s+)?emm(?:y|ys|ies)/i);
            if (mEmmyWin && Number(mEmmyWin[1]) > emmyWins) {
                emmyWins = Number(mEmmyWin[1]);
            }

            var mGlobeWin = rawAwards.match(/won\s+(\d+)\s+golden\s+globe/i);
            if (mGlobeWin && Number(mGlobeWin[1]) > globeWins) {
                globeWins = Number(mGlobeWin[1]);
            }

            var winsRegex = /(\d+)\s+win/gi;
            var wMatch;
            while ((wMatch = winsRegex.exec(rawAwards)) !== null) {
                var wNum = Number(wMatch[1]) || 0;
                if (wNum > totalWins) {
                    totalWins = wNum;
                }
            }
        }

        var ru = isRuLang();

        if (oscarWins > 0) {
            return {
                label: '🏆 ' + oscarWins + ' ' + (ru
                    ? formatPlural(oscarWins, 'Оскар', 'Оскара', 'Оскаров')
                    : formatPlural(oscarWins, 'Оскар', 'Оскари', 'Оскарів')),
                tooltip: rawAwards || (ru ? 'Премия «Оскар»' : 'Премія «Оскар»')
            };
        }

        if (oscarNoms > 0) {
            return {
                label: '🏆 ' + oscarNoms + (ru ? ' номинац. на Оскар' : ' номінац. на Оскар'),
                tooltip: rawAwards || (ru ? 'Номинация на премию «Оскар»' : 'Номінація на премію «Оскар»')
            };
        }

        if (emmyWins > 0) {
            return {
                label: '🏆 ' + emmyWins + (ru ? ' Эмми' : ' Еммі'),
                tooltip: rawAwards || (ru ? 'Премия «Эмми»' : 'Премія «Еммі»')
            };
        }

        if (globeWins > 0) {
            return {
                label: '🏆 ' + globeWins + ' ' + (ru
                    ? formatPlural(globeWins, 'Золотой глобус', 'Золотых глобуса', 'Золотых глобусов')
                    : formatPlural(globeWins, 'Золотий глобус', 'Золоті глобуси', 'Золотих глобусів')),
                tooltip: rawAwards || (ru ? 'Премия «Золотой глобус»' : 'Премія «Золотий глобус»')
            };
        }

        if (totalWins > 0) {
            return {
                label: '🏆 ' + totalWins + ' ' + (ru
                    ? formatPlural(totalWins, 'награда', 'награды', 'наград')
                    : formatPlural(totalWins, 'нагорода', 'нагороди', 'нагород')),
                tooltip: rawAwards || (ru ? 'Кинонаграды' : 'Кінонагороди')
            };
        }

        return null;
    }

    function formatVotesText(votes) {
        var num = Number(votes);
        if (!num || isNaN(num) || num <= 0) return '';
        var ru = isRuLang();
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1).replace(/\.0$/, '') + (ru ? 'M голосов' : 'M голосів');
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1).replace(/\.0$/, '') + (ru ? 'K голосов' : 'K голосів');
        }
        return Math.round(num) + ' ' + (ru
            ? formatPlural(num, 'голос', 'голоса', 'голосов')
            : formatPlural(num, 'голос', 'голоси', 'голосів'));
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
            return createEmptyReactions(loc('Не вдалося отримати розподіл оцінок Trakt', 'Не удалось получить распределение оценок Trakt'), false);
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
                renderSettingsProfileStats();
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
                Lampa.Noty.show(loc('Спочатку введіть Trakt Client ID у полі нижче', 'Сначала введите Trakt Client ID в поле ниже'));
            }
            return;
        }

        stopDevicePolling();

        xhrTraktRequest('POST', 'https://api.trakt.tv/oauth/device/code', {
            client_id: keys.traktClientId
        }, '', keys.traktClientId, function(status, codeData) {
            if (status !== 200 || !codeData || !codeData.device_code || !codeData.user_code) {
                if (window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show(loc('Помилка отримання коду активації Trakt (HTTP ', 'Ошибка получения кода активации Trakt (HTTP ') + status + ')');
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
                '<div class="mdb-auth-desc">' + loc('Відкрийте у браузері на телефоні або комп’ютері:', 'Откройте в браузере на телефоне или компьютере:') + '</div>' +
                '<div class="mdb-auth-url">' + verifyUrl + '</div>' +
                '<div class="mdb-auth-desc">' + loc('Та введіть цей код активації:', 'И введите этот код активации:') + '</div>' +
                '<div class="mdb-auth-code">' + userCode + '</div>' +
                '<div class="mdb-auth-status">' + loc('Очікування підтвердження в Trakt...', 'Ожидание подтверждения в Trakt...') + '</div>';

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
                    title: loc('Підключення акаунта Trakt', 'Подключение аккаунта Trakt'),
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
                    if (statusNode) statusNode.textContent = loc('Час дії коду вичерпано. Спробуйте ще раз.', 'Время действия кода истекло. Попробуйте ещё раз.');
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
                        clearTraktProfileStatsCache();
                        closeAuthModal();
                        refreshSettingsAuthUi();
                        if (window.Lampa && Lampa.Noty) {
                            Lampa.Noty.show(loc('Успішно підключено до Trakt!', 'Успешно подключено к Trakt!'));
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
                        if (statusNode) statusNode.textContent = loc('Авторизацію відхилено користувачем.', 'Авторизация отклонена пользователем.');
                        window.setTimeout(closeAuthModal, 1800);
                        return;
                    }

                    if (tokStatus === 409 || tokStatus === 410 || tokStatus === 404) {
                        if (statusNode) statusNode.textContent = loc('Код активації недійсний або протермінований.', 'Код активации недействителен или просрочен.');
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
            if (!raw || typeof raw !== 'object' || !raw._ts || !raw.map) return null;
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

    function updateLocalTraktSyncMap(isShow, movie, mdbJson, reactionKey, onlyIfExists) {
        var key = isShow ? TRAKT_SYNC_CACHE_SHOWS : TRAKT_SYNC_CACHE_MOVIES;
        var map = readTraktTimedMap(key);
        if (!map) {
            if (onlyIfExists) return;
            map = {};
        }

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
                Lampa.Noty.show(loc('Помилка Trakt: відсутній Client ID', 'Ошибка Trakt: отсутствует Client ID'));
            }
            return;
        }

        ensureValidTraktToken(function(token) {
            if (!token) {
                if (window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show(loc('Помилка Trakt: відсутній токен авторизації', 'Ошибка Trakt: отсутствует токен авторизации'));
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
                    clearTraktProfileStatsCache();
                    updateLocalWatchedMap(isShow, movie, mdbJson, newVal);
                    syncNativeLampaWatched(movie, Boolean(markAsWatched));
                    if (typeof onDone === 'function') onDone(true, newVal);
                    return;
                }

                var errReason = (res && (res.error_description || res.error || res.message))
                    ? (' - ' + (res.error_description || res.error || res.message))
                    : (hasNotFoundItems(res) ? loc(' (не знайдено)', ' (не найдено)') : '');
                if (window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show(loc('Помилка Trakt: HTTP ', 'Ошибка Trakt: HTTP ') + status + errReason);
                }
                if (typeof onDone === 'function') onDone(false, null);
            });
        });
    }

    function sendShowSeasonHistoryOnTrakt(movie, mdbJson, mode, seasonNum, onDone) {
        var clientId = trimStr(getStorageStr('trakt_client_id', ''));
        if (!clientId) {
            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show(loc('Помилка Trakt: відсутній Client ID', 'Ошибка Trakt: отсутствует Client ID'));
            }
            return;
        }

        ensureValidTraktToken(function(token) {
            if (!token) {
                if (window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show(loc('Помилка Trakt: відсутній токен авторизації', 'Ошибка Trakt: отсутствует токен авторизации'));
                }
                return;
            }

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
            if (mode === 'season' && seasonNum > 0) {
                itemObj.seasons = new Array({ number: parseInt(seasonNum, 10) });
            }

            var payload = {
                shows: new Array(itemObj)
            };

            var endpoint = (mode === 'remove')
                ? 'https://api.trakt.tv/sync/history/remove'
                : 'https://api.trakt.tv/sync/history';

            logDebug('POST ' + endpoint + ' show/season payload:', JSON.stringify(payload));
            xhrTraktRequest('POST', endpoint, payload, token, clientId, function(status, res, rawText) {
                logDebug('POST ' + endpoint + ' відповідь:', status, rawText);
                var ok = isTraktSuccessStatus(status) && !hasNotFoundItems(res);

                if (ok) {
                    clearTraktWatchedCache();
                    clearTraktProfileStatsCache();
                    if (typeof onDone === 'function') onDone(true);
                    return;
                }

                var errReason = (res && (res.error_description || res.error || res.message))
                    ? (' - ' + (res.error_description || res.error || res.message))
                    : (hasNotFoundItems(res) ? loc(' (не знайдено)', ' (не найдено)') : '');
                if (window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show(loc('Помилка Trakt: HTTP ', 'Ошибка Trakt: HTTP ') + status + errReason);
                }
                if (typeof onDone === 'function') onDone(false);
            });
        });
    }

    function getAvailableShowSeasons(movie) {
        var seasonsList = new Array();
        var i;
        if (movie && movie.seasons && movie.seasons.length > 0) {
            for (i = 0; i < movie.seasons.length; i++) {
                var s = movie.seasons[i];
                if (s && Number(s.season_number) > 0) {
                    seasonsList.push({
                        number: Number(s.season_number),
                        episodeCount: Number(s.episode_count) || 0
                    });
                }
            }
            seasonsList.sort(function(a, b) {
                return a.number - b.number;
            });
        } else if (movie && Number(movie.number_of_seasons) > 0) {
            var totalSeasons = Number(movie.number_of_seasons);
            for (i = 1; i <= totalSeasons; i++) {
                seasonsList.push({
                    number: i,
                    episodeCount: 0
                });
            }
        }
        return seasonsList;
    }

    function openShowWatchedMenu(rootEl, movie, data) {
        if (!window.Lampa || !Lampa.Select || typeof Lampa.Select.show !== 'function') {
            var fallbackCur = Boolean(data.watchedStatus && data.watchedStatus.watchedEpisodes > 0);
            toggleWatchedOnTrakt(movie, data.mdbJson || null, !fallbackCur, function(ok, newVal) {
                if (!ok) return;
                data.watchedStatus = buildWatchedStatusObj(newVal, movie, data.mdbJson || null);
                renderIntoCard(rootEl, movie, data, 'status');
            });
            return;
        }

        var watchedCount = (data.watchedStatus && data.watchedStatus.watchedEpisodes) ? Number(data.watchedStatus.watchedEpisodes) : 0;
        var selectItems = new Array();
        var seasonsList = getAvailableShowSeasons(movie);
        var i;

        selectItems.push({
            title: loc('Позначити весь серіал переглянутим', 'Отметить весь сериал просмотренным'),
            action: 'all',
            seasonNumber: 0,
            episodeCount: countTotalShowEpisodes(movie, data.mdbJson || null)
        });

        for (i = 0; i < seasonsList.length; i++) {
            selectItems.push({
                title: loc('Позначити Сезон ' + seasonsList[i].number + ' переглянутим', 'Отметить Сезон ' + seasonsList[i].number + ' просмотренным'),
                action: 'season',
                seasonNumber: seasonsList[i].number,
                episodeCount: seasonsList[i].episodeCount
            });
        }

        if (watchedCount > 0) {
            selectItems.push({
                title: loc('Очистити історію перегляду серіалу', 'Очистить историю просмотра сериала'),
                action: 'remove',
                seasonNumber: 0,
                episodeCount: 0
            });
        }

        var prevController = 'content';
        try {
            if (Lampa.Controller && typeof Lampa.Controller.enabled === 'function') {
                var activeCtrl = Lampa.Controller.enabled();
                if (activeCtrl && activeCtrl.name) {
                    prevController = activeCtrl.name;
                }
            }
        } catch (ePrev) {
            /* ignore */
        }

        var restoreControllerAndFocus = function() {
            if (window.Lampa && Lampa.Controller && typeof Lampa.Controller.toggle === 'function') {
                try {
                    Lampa.Controller.toggle(prevController);
                } catch (eTog) {
                    /* ignore */
                }
            }
            var btnEl = rootEl.querySelector('.mdb-trakt-watched-btn');
            if (btnEl && window.Lampa && Lampa.Controller && typeof Lampa.Controller.collectionFocus === 'function') {
                try {
                    Lampa.Controller.collectionFocus(btnEl);
                } catch (eFoc) {
                    /* ignore */
                }
            }
        };

        Lampa.Select.show({
            title: loc('Історія перегляду серіалу', 'История просмотра сериала'),
            items: selectItems,
            onSelect: function(selected) {
                restoreControllerAndFocus();
                if (!selected || !selected.action) return;

                sendShowSeasonHistoryOnTrakt(movie, data.mdbJson || null, selected.action, selected.seasonNumber, function(ok) {
                    if (!ok) return;

                    if (selected.action === 'all') {
                        var totalEps = countTotalShowEpisodes(movie, data.mdbJson || null);
                        var allVal = Math.max(1, totalEps);
                        updateLocalWatchedMap(true, movie, data.mdbJson || null, allVal);
                        syncNativeLampaWatched(movie, true);
                        data.watchedStatus = buildWatchedStatusObj(allVal, movie, data.mdbJson || null);
                        renderIntoCard(rootEl, movie, data, 'status');
                        restoreControllerAndFocus();
                        if (Lampa.Noty) Lampa.Noty.show(loc('Позначено весь серіал переглянутим', 'Весь сериал отмечен просмотренным'));
                    } else if (selected.action === 'remove') {
                        updateLocalWatchedMap(true, movie, data.mdbJson || null, 0);
                        syncNativeLampaWatched(movie, false);
                        data.watchedStatus = buildWatchedStatusObj(0, movie, data.mdbJson || null);
                        renderIntoCard(rootEl, movie, data, 'status');
                        restoreControllerAndFocus();
                        if (Lampa.Noty) Lampa.Noty.show(loc('Історію перегляду серіалу очищено', 'История просмотра сериала очищена'));
                    } else if (selected.action === 'season') {
                        var prevWatched = (data.watchedStatus && data.watchedStatus.watchedEpisodes) ? Number(data.watchedStatus.watchedEpisodes) : 0;
                        var estAdded = selected.episodeCount > 0 ? selected.episodeCount : 1;
                        var totalKnown = countTotalShowEpisodes(movie, data.mdbJson || null);
                        var optimisticVal = totalKnown > 0 ? Math.min(totalKnown, prevWatched + estAdded) : (prevWatched + estAdded);

                        data.watchedStatus = buildWatchedStatusObj(optimisticVal, movie, data.mdbJson || null);
                        renderIntoCard(rootEl, movie, data, 'status');
                        restoreControllerAndFocus();
                        if (Lampa.Noty) Lampa.Noty.show(loc('Позначено Сезон ' + selected.seasonNumber + ' переглянутим', 'Сезон ' + selected.seasonNumber + ' отмечен просмотренным'));

                        fetchUserWatchedStatusForMedia(movie, data.mdbJson || null, function(freshStatus) {
                            if (freshStatus) {
                                data.watchedStatus = freshStatus;
                                renderIntoCard(rootEl, movie, data, 'status');
                                restoreControllerAndFocus();
                            }
                        });
                    }
                });
            },
            onBack: function() {
                restoreControllerAndFocus();
            }
        });
    }

    function syncReactionToTrakt(movie, mdbJson, reactionKey) {
        var clientId = trimStr(getStorageStr('trakt_client_id', ''));
        if (!clientId) {
            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show(loc('Помилка Trakt: відсутній Client ID', 'Ошибка Trakt: отсутствует Client ID'));
            }
            return;
        }

        ensureValidTraktToken(function(token) {
            if (!token) {
                if (window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show(loc('Помилка Trakt: відсутній токен авторизації', 'Ошибка Trakt: отсутствует токен авторизации'));
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
                        updateLocalTraktSyncMap(isShow, movie, mdbJson, reactionKey, false);
                        clearTraktProfileStatsCache();
                    } else {
                        var errReason = (res && (res.error_description || res.error || res.message))
                            ? (' - ' + (res.error_description || res.error || res.message))
                            : (hasNotFoundItems(res) ? loc(' (не знайдено)', ' (не найдено)') : '');
                        if (window.Lampa && Lampa.Noty) {
                            Lampa.Noty.show(loc('Помилка Trakt: HTTP ', 'Ошибка Trakt: HTTP ') + status + errReason);
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
                        updateLocalTraktSyncMap(isShow, movie, mdbJson, '', false);
                        clearTraktProfileStatsCache();
                    } else {
                        var errReason = (res && (res.error_description || res.error || res.message))
                            ? (' - ' + (res.error_description || res.error || res.message))
                            : (hasNotFoundItems(res) ? loc(' (не знайдено)', ' (не найдено)') : '');
                        if (window.Lampa && Lampa.Noty) {
                            Lampa.Noty.show(loc('Помилка Trakt: HTTP ', 'Ошибка Trakt: HTTP ') + status + errReason);
                        }
                    }
                });
            }
        });
    }

    function importLampaHistoryToTrakt() {
        if (historyImportInProgress) return;

        var keys = getApiKeys();
        if (!isTraktLoggedIn()) {
            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show(loc('Спочатку увійдіть у Trakt', 'Сначала войдите в Trakt'));
            }
            return;
        }
        if (!keys.traktClientId) {
            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show(loc('Спочатку введіть Trakt Client ID', 'Сначала введите Trakt Client ID'));
            }
            return;
        }

        var historyList = (window.Lampa && Lampa.Favorite && typeof Lampa.Favorite.get === 'function')
            ? Lampa.Favorite.get({ type: 'history' })
            : new Array();

        if (!historyList || !historyList.length) {
            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show(loc('Локальна історія переглядів Lampa порожня', 'Локальная история просмотров Lampa пуста'));
            }
            return;
        }

        var seenMap = {};
        var queueItems = new Array();
        var i;

        for (i = 0; i < historyList.length; i++) {
            var item = historyList[i];
            if (!item || !item.id) continue;
            var tmdbNum = parseInt(item.id, 10);
            if (isNaN(tmdbNum) || tmdbNum <= 0) continue;

            var isShow = Boolean(item.first_air_date || item.number_of_seasons || item.original_name || (item.seasons && item.seasons.length));
            var dedupKey = (isShow ? 's_' : 'm_') + tmdbNum;
            if (seenMap[dedupKey]) continue;
            seenMap[dedupKey] = true;

            queueItems.push({
                isShow: isShow,
                tmdb: tmdbNum
            });
        }

        if (queueItems.length === 0) {
            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show(loc('Не знайдено коректних записів TMDB для імпорту', 'Не найдено корректных записей TMDB для импорта'));
            }
            return;
        }

        historyImportInProgress = true;
        if (window.Lampa && Lampa.Noty) {
            Lampa.Noty.show(loc('Імпорт історії переглядів у Trakt...', 'Импорт истории просмотров в Trakt...'));
        }

        ensureValidTraktToken(function(token) {
            if (!token) {
                historyImportInProgress = false;
                if (window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show(loc('Помилка Trakt: відсутній токен авторизації', 'Ошибка Trakt: отсутствует токен авторизации'));
                }
                return;
            }

            var chunks = new Array();
            var chunkSize = 50;
            var idx;
            for (idx = 0; idx < queueItems.length; idx += chunkSize) {
                chunks.push(queueItems.slice(idx, idx + chunkSize));
            }

            var chunkIdx = 0;
            var totalMoviesSent = 0;
            var totalShowsSent = 0;
            var totalMoviesNotFound = 0;
            var totalShowsNotFound = 0;
            var hadError = false;

            var sendNextChunk = function() {
                if (chunkIdx >= chunks.length) {
                    historyImportInProgress = false;
                    clearTraktWatchedCache();
                    clearTraktProfileStatsCache();
                    renderSettingsProfileStats();

                    var importedMovies = Math.max(0, totalMoviesSent - totalMoviesNotFound);
                    var importedShows = Math.max(0, totalShowsSent - totalShowsNotFound);

                    if (window.Lampa && Lampa.Noty) {
                        if (hadError && importedMovies === 0 && importedShows === 0) {
                            Lampa.Noty.show(loc('Не вдалося імпортувати історію в Trakt', 'Не удалось импортировать историю в Trakt'));
                        } else {
                            Lampa.Noty.show(loc('Імпортовано в Trakt: ', 'Импортировано в Trakt: ') +
                                importedMovies + loc(' фільмів та ', ' фильмов и ') +
                                importedShows + loc(' серіалів!', ' сериалов!'));
                        }
                    }
                    return;
                }

                var currentChunk = chunks[chunkIdx];
                chunkIdx++;

                var moviesBatch = new Array();
                var showsBatch = new Array();
                var cIdx;
                for (cIdx = 0; cIdx < currentChunk.length; cIdx++) {
                    if (currentChunk[cIdx].isShow) {
                        showsBatch.push({ ids: { tmdb: currentChunk[cIdx].tmdb } });
                    } else {
                        moviesBatch.push({ ids: { tmdb: currentChunk[cIdx].tmdb } });
                    }
                }

                var payload = {};
                if (moviesBatch.length > 0) payload.movies = moviesBatch;
                if (showsBatch.length > 0) payload.shows = showsBatch;

                xhrTraktRequest('POST', 'https://api.trakt.tv/sync/history', payload, token, keys.traktClientId, function(status, res) {
                    if (isTraktSuccessStatus(status)) {
                        totalMoviesSent += moviesBatch.length;
                        totalShowsSent += showsBatch.length;
                        if (res && res.not_found) {
                            if (res.not_found.movies && res.not_found.movies.length) {
                                totalMoviesNotFound += res.not_found.movies.length;
                            }
                            if (res.not_found.shows && res.not_found.shows.length) {
                                totalShowsNotFound += res.not_found.shows.length;
                            }
                        }
                    } else {
                        hadError = true;
                        logDebug('Помилка імпорту chunk у Trakt:', status);
                    }
                    window.setTimeout(sendNextChunk, 180);
                });
            };

            sendNextChunk();
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
                        if (!card.source) card.source = 'tmdb';
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
                var lang = getStorageStr('language', 'uk') === 'ru' ? 'ru-RU' : 'uk-UA';
                var tmdbUrl = Lampa.TMDB.api(typePath + '/' + tmdbId + '?api_key=' + Lampa.TMDB.key() + '&language=' + lang);
                var xhr = new XMLHttpRequest();
                xhr.open('GET', tmdbUrl, true);
                xhr.timeout = 10000;
                xhr.onreadystatechange = function() {
                    if (xhr.readyState !== 4) return;
                    if (xhr.status === 200) {
                        try {
                            var card = JSON.parse(xhr.responseText);
                            if (card && card.id) {
                                if (!card.source) card.source = 'tmdb';
                                callback(card);
                                return;
                            }
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
        if (!items || !items.length) {
            onComplete(new Array());
            return;
        }

        var resultsByIndex = new Array(items.length);
        var nextIndex = 0;
        var completedCount = 0;
        var concurrency = Math.min(5, items.length);

        function worker() {
            if (nextIndex >= items.length) return;
            var currentIdx = nextIndex;
            nextIndex++;
            var currentItem = items[currentIdx];

            fetchTmdbCardObject(currentItem.tmdbId, currentItem.isShow, function(card) {
                resultsByIndex[currentIdx] = (card && card.id) ? card : null;
                completedCount++;
                if (completedCount >= items.length) {
                    var ordered = new Array();
                    var k;
                    for (k = 0; k < resultsByIndex.length; k++) {
                        if (resultsByIndex[k]) ordered.push(resultsByIndex[k]);
                    }
                    onComplete(ordered);
                } else {
                    window.setTimeout(worker, 25);
                }
            });
        }

        var w;
        for (w = 0; w < concurrency; w++) {
            worker();
        }
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

    function getLocalBookmarks() {
        try {
            if (!window.Lampa || !Lampa.Favorite || typeof Lampa.Favorite.get !== 'function') {
                return new Array();
            }
            var list = Lampa.Favorite.get({ type: 'book' });
            if (!list || !list.length) return new Array();
            var out = new Array();
            var i;
            for (i = 0; i < list.length; i++) {
                if (list[i] && list[i].id) {
                    if (!list[i].source) list[i].source = 'tmdb';
                    out.push(list[i]);
                }
            }
            return out;
        } catch (err) {
            return new Array();
        }
    }

    function getBookmarksSignature(list) {
        if (!list || !list.length) return '';
        var ids = new Array();
        var i;
        for (i = 0; i < list.length; i++) {
            if (list[i] && list[i].id) {
                ids.push(String(list[i].id));
            }
        }
        return ids.join(',');
    }

    function findAllBookmarksItemsLines() {
        var found = new Array();
        var titleTarget = loc('Закладки', 'Закладки');
        var lines = document.querySelectorAll('.items-line');
        var i;
        for (i = 0; i < lines.length; i++) {
            if (lines[i].getAttribute('data-mdb-bookmarks-row') === '1') {
                found.push(lines[i]);
                continue;
            }
            var titleEl = lines[i].querySelector('.items-line__title');
            if (titleEl && trimStr(titleEl.textContent) === titleTarget) {
                lines[i].setAttribute('data-mdb-bookmarks-row', '1');
                found.push(lines[i]);
            }
        }
        return found;
    }

    function openNativeBookmarksView() {
        if (!window.Lampa || !Lampa.Activity || typeof Lampa.Activity.push !== 'function') return;
        Lampa.Activity.push({
            url: '',
            title: loc('Закладки', 'Закладки'),
            component: BOOKMARKS_FULL_COMPONENT,
            page: 1
        });
    }

    function bindBookmarksMoreElements(lineEl) {
        if (!lineEl) return;
        var targets = lineEl.querySelectorAll('.items-line__more, .card-more');
        var i;

        for (i = 0; i < targets.length; i++) {
            (function(btn) {
                if (!btn || btn.getAttribute('data-mdb-more-bound') === '1') return;
                btn.setAttribute('data-mdb-more-bound', '1');

                var handleMoreAction = function(ev) {
                    if (ev) {
                        if (typeof ev.preventDefault === 'function') ev.preventDefault();
                        if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
                        if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
                    }
                    openNativeBookmarksView();
                    return false;
                };

                if (window.$) {
                    try {
                        window.$(btn).off('hover:enter click').on('hover:enter click', handleMoreAction);
                    } catch (eJq) {
                        /* ignore jQuery errors */
                    }
                }

                btn.addEventListener('click', handleMoreAction, true);
                btn.addEventListener('hover:enter', handleMoreAction, true);
            })(targets[i]);
        }
    }

    function getBookmarkCardDisplayTitle(card) {
        if (!card) return '';
        return trimStr(card.title || card.name || card.original_title || card.original_name || '');
    }

    function resolveCardIdFromDom(cardEl, books) {
        if (!cardEl) return 0;

        var attrId = cardEl.getAttribute('data-mdb-book-id');
        if (attrId && Number(attrId) > 0) {
            return Number(attrId);
        }

        if (cardEl._mdbCardItem && cardEl._mdbCardItem.id) {
            return Number(cardEl._mdbCardItem.id);
        }

        if (window.$) {
            var $el = window.$(cardEl);
            var jqData = $el.data('item') || $el.data('card') || $el.data('json') || $el.data('data');
            if (jqData && jqData.id) {
                cardEl.setAttribute('data-mdb-book-id', String(jqData.id));
                cardEl._mdbCardItem = jqData;
                return Number(jqData.id);
            }
        }

        if (cardEl.card_data && cardEl.card_data.id) {
            cardEl.setAttribute('data-mdb-book-id', String(cardEl.card_data.id));
            cardEl._mdbCardItem = cardEl.card_data;
            return Number(cardEl.card_data.id);
        }

        if (books && books.length) {
            var imgEl = cardEl.querySelector('img');
            var imgSrc = imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : '';
            var titleNode = cardEl.querySelector('.card__title');
            var domTitle = titleNode ? trimStr(titleNode.textContent) : '';
            var i;

            if (imgSrc) {
                for (i = 0; i < books.length; i++) {
                    if (books[i] && books[i].poster_path && imgSrc.indexOf(books[i].poster_path) !== -1) {
                        cardEl.setAttribute('data-mdb-book-id', String(books[i].id));
                        cardEl._mdbCardItem = books[i];
                        return Number(books[i].id);
                    }
                }
            }

            if (domTitle) {
                for (i = 0; i < books.length; i++) {
                    if (books[i] && getBookmarkCardDisplayTitle(books[i]) === domTitle) {
                        cardEl.setAttribute('data-mdb-book-id', String(books[i].id));
                        cardEl._mdbCardItem = books[i];
                        return Number(books[i].id);
                    }
                }
            }
        }

        return 0;
    }

    function doesDomCardMatchTarget(cardEl, targetCard) {
        if (!cardEl || !targetCard || !targetCard.id) return false;
        var resolvedId = resolveCardIdFromDom(cardEl, new Array(targetCard));
        if (resolvedId && Number(resolvedId) === Number(targetCard.id)) {
            return true;
        }
        var imgEl = cardEl.querySelector('img');
        var imgSrc = imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : '';
        if (targetCard.poster_path && imgSrc && imgSrc.indexOf(targetCard.poster_path) !== -1) {
            return true;
        }
        var titleNode = cardEl.querySelector('.card__title');
        var domTitle = titleNode ? trimStr(titleNode.textContent) : '';
        var targetTitle = getBookmarkCardDisplayTitle(targetCard);
        if (domTitle && targetTitle && domTitle === targetTitle) {
            return true;
        }
        return false;
    }

    function getBookmarkPosterUrl(cardData) {
        if (!cardData) return '';
        if (cardData.poster_path) {
            try {
                if (window.Lampa && Lampa.TMDB && typeof Lampa.TMDB.image === 'function') {
                    return Lampa.TMDB.image('t/p/w300' + cardData.poster_path);
                }
            } catch (eImg) {
                /* fallback */
            }
            return 'https://image.tmdb.org/t/p/w300' + cardData.poster_path;
        }
        return cardData.img || cardData.poster || '';
    }

    function openBookmarkMovieCard(cardData) {
        if (!window.Lampa || !Lampa.Activity || !cardData || !cardData.id) return;
        Lampa.Activity.push({
            url: '',
            component: 'full',
            id: cardData.id,
            method: (cardData.first_air_date || cardData.name) ? 'tv' : 'movie',
            card: cardData,
            source: cardData.source || 'tmdb'
        });
    }

    function createNativeBookmarksCard(cardData) {
        if (!cardData || !cardData.id) return null;
        var cardObj = null;

        try {
            if (window.Lampa && Lampa.Maker && typeof Lampa.Maker.make === 'function') {
                cardObj = Lampa.Maker.make('Card', cardData, { card_category: true });
            } else if (window.Lampa && typeof Lampa.Card === 'function') {
                cardObj = new Lampa.Card(cardData, { card_category: true });
            }
        } catch (eMake) {
            cardObj = null;
        }

        if (cardObj && typeof cardObj.create === 'function' && typeof cardObj.render === 'function') {
            try {
                cardObj.onEnter = function() {
                    openBookmarkMovieCard(cardData);
                };
                cardObj.create();
                var rendered = cardObj.render();
                var domEl = (rendered && rendered.jquery) ? rendered[0] : rendered;
                if (domEl && domEl.nodeType === 1) {
                    if (typeof cardObj.visible === 'function') {
                        cardObj.visible();
                    }
                    domEl.setAttribute('data-mdb-book-id', String(cardData.id));
                    domEl._mdbCardItem = cardData;
                    return domEl;
                }
            } catch (eRender) {
                logDebug('Помилка створення картки закладок:', eRender && eRender.message ? eRender.message : eRender);
            }
        }

        var fallbackCard = document.createElement('div');
        fallbackCard.className = 'card selector layer--visible';
        fallbackCard.setAttribute('data-mdb-book-id', String(cardData.id));
        fallbackCard._mdbCardItem = cardData;

        var viewEl = document.createElement('div');
        viewEl.className = 'card__view';

        var imgUrl = getBookmarkPosterUrl(cardData);
        if (imgUrl) {
            var imgEl = document.createElement('img');
            imgEl.className = 'card__img loaded';
            imgEl.src = imgUrl;
            imgEl.alt = getBookmarkCardDisplayTitle(cardData);
            viewEl.appendChild(imgEl);
        }

        var titleEl = document.createElement('div');
        titleEl.className = 'card__title';
        titleEl.textContent = getBookmarkCardDisplayTitle(cardData);

        fallbackCard.appendChild(viewEl);
        fallbackCard.appendChild(titleEl);

        var onCardEnter = function(ev) {
            if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
            openBookmarkMovieCard(cardData);
        };
        fallbackCard.addEventListener('click', onCardEnter);
        if (window.$) {
            window.$(fallbackCard).on('hover:enter', onCardEnter);
        } else {
            fallbackCard.addEventListener('hover:enter', onCardEnter);
        }

        return fallbackCard;
    }

    function getBookmarksCardsContainer(lineEl) {
        if (!lineEl) return null;
        return lineEl.querySelector('.scroll__body') || lineEl.querySelector('.items-line__body');
    }

    function createFallbackBookmarksLineShell(rowTitle) {
        var lineEl = document.createElement('div');
        lineEl.className = 'items-line layer--visible';
        lineEl.setAttribute('data-mdb-bookmarks-row', '1');

        var headEl = document.createElement('div');
        headEl.className = 'items-line__head';

        var titleEl = document.createElement('div');
        titleEl.className = 'items-line__title';
        titleEl.textContent = rowTitle;

        var moreEl = document.createElement('div');
        moreEl.className = 'items-line__more selector';
        moreEl.textContent = loc('Ще', 'Ещё');

        headEl.appendChild(titleEl);
        headEl.appendChild(moreEl);

        var bodyEl = document.createElement('div');
        bodyEl.className = 'items-line__body';

        var scrollEl = document.createElement('div');
        scrollEl.className = 'scroll scroll--horizontal';

        var scrollContent = document.createElement('div');
        scrollContent.className = 'scroll__content';

        var scrollBody = document.createElement('div');
        scrollBody.className = 'scroll__body';

        scrollContent.appendChild(scrollBody);
        scrollEl.appendChild(scrollContent);
        bodyEl.appendChild(scrollEl);

        lineEl.appendChild(headEl);
        lineEl.appendChild(bodyEl);

        bindBookmarksMoreElements(lineEl);
        return lineEl;
    }

    function ensureBookmarksLineMountedIfMissing(desiredBooks) {
        if (!desiredBooks || desiredBooks.length === 0) return null;
        var activeRoot = document.querySelector('.activity--active');
        if (!activeRoot) return null;

        var isMainActive = false;
        try {
            if (window.Lampa && Lampa.Activity && typeof Lampa.Activity.active === 'function') {
                var act = Lampa.Activity.active();
                isMainActive = Boolean(act && act.component === 'main');
            }
        } catch (eAct) {
            isMainActive = false;
        }
        if (!isMainActive) return null;

        var mainScrollBody = activeRoot.querySelector('.scroll--vertical .scroll__body') ||
            activeRoot.querySelector('.activity__body .scroll__body') ||
            activeRoot.querySelector('.scroll__body');
        if (!mainScrollBody) return null;

        var newLine = createFallbackBookmarksLineShell(loc('Закладки', 'Закладки'));
        var existingLines = mainScrollBody.querySelectorAll('.items-line');
        if (existingLines.length > 1 && existingLines[1].parentNode === mainScrollBody) {
            mainScrollBody.insertBefore(newLine, existingLines[1]);
        } else {
            mainScrollBody.appendChild(newLine);
        }
        return newLine;
    }

    function syncSingleBookmarksLineDom(lineEl, desiredBooks, showRow) {
        if (!lineEl) return;

        if (!showRow || !desiredBooks || desiredBooks.length === 0) {
            lineEl.style.display = 'none';
            return;
        }

        lineEl.style.display = '';
        bindBookmarksMoreElements(lineEl);

        var cardsContainer = getBookmarksCardsContainer(lineEl);
        if (!cardsContainer) return;

        var desiredMap = {};
        var i;
        for (i = 0; i < desiredBooks.length; i++) {
            desiredMap[String(desiredBooks[i].id)] = desiredBooks[i];
        }

        var existingCards = cardsContainer.querySelectorAll('.card:not(.card-more)');
        var presentMap = {};
        for (i = 0; i < existingCards.length; i++) {
            var cardNode = existingCards[i];
            var resolvedId = resolveCardIdFromDom(cardNode, desiredBooks);
            var idKey = resolvedId ? String(resolvedId) : '';
            if (!idKey || !desiredMap[idKey]) {
                if (cardNode.parentNode) {
                    cardNode.parentNode.removeChild(cardNode);
                }
            } else {
                presentMap[idKey] = cardNode;
            }
        }

        var moreCard = cardsContainer.querySelector('.card-more');

        for (i = desiredBooks.length - 1; i >= 0; i--) {
            var bookItem = desiredBooks[i];
            var bookKey = String(bookItem.id);
            if (!presentMap[bookKey]) {
                var newCardEl = createNativeBookmarksCard(bookItem);
                if (newCardEl) {
                    var nextSibling = (i + 1 < desiredBooks.length) ? presentMap[String(desiredBooks[i + 1].id)] : null;
                    if (nextSibling && nextSibling.parentNode === cardsContainer) {
                        cardsContainer.insertBefore(newCardEl, nextSibling);
                    } else if (moreCard && moreCard.parentNode === cardsContainer) {
                        cardsContainer.insertBefore(newCardEl, moreCard);
                    } else if (cardsContainer.firstChild) {
                        cardsContainer.insertBefore(newCardEl, cardsContainer.firstChild);
                    } else {
                        cardsContainer.appendChild(newCardEl);
                    }
                    presentMap[bookKey] = newCardEl;
                }
            }
        }
    }

    function syncBookmarksShelfDom(forceSync) {
        try {
            var settings = getSettings();
            var books = getLocalBookmarks();
            var desired = books.length > 0 ? books.slice(0, 20) : new Array();
            var currentSig = getBookmarksSignature(desired);
            var lines = findAllBookmarksItemsLines();
            var i;

            for (i = 0; i < lines.length; i++) {
                lines[i].style.display = (settings.showBookmarksRow && desired.length > 0) ? '' : 'none';
                bindBookmarksMoreElements(lines[i]);
            }

            if (!forceSync && currentSig === lastBookmarksShelfSignature && lines.length > 0) {
                return;
            }
            lastBookmarksShelfSignature = currentSig;

            if (lines.length === 0 && settings.showBookmarksRow && desired.length > 0) {
                var createdLine = ensureBookmarksLineMountedIfMissing(desired);
                if (createdLine) {
                    lines.push(createdLine);
                }
            }

            for (i = 0; i < lines.length; i++) {
                syncSingleBookmarksLineDom(lines[i], desired, settings.showBookmarksRow);
            }
        } catch (err) {
            logDebug('Помилка оновлення полиці Закладки:', err && err.message ? err.message : err);
        }
    }

    function applyBookmarksShelfVisibility() {
        syncBookmarksShelfDom(false);
    }

    function registerBookmarksFullComponent() {
        if (!window.Lampa || !Lampa.Component || typeof Lampa.Component.add !== 'function') return;

        Lampa.Component.add(BOOKMARKS_FULL_COMPONENT, function() {
            var scroll = null;
            var html = document.createElement('div');
            html.className = 'category-full';
            var cardInstances = new Array();
            var cardElements = new Array();
            var lastFocusedEl = null;
            var renderedSignature = '__init__';

            var destroyCards = function() {
                var i;
                for (i = 0; i < cardInstances.length; i++) {
                    try {
                        if (cardInstances[i] && typeof cardInstances[i].destroy === 'function') {
                            cardInstances[i].destroy();
                        }
                    } catch (eDest) {
                        /* ignore */
                    }
                }
                cardInstances = new Array();
                cardElements = new Array();
                lastFocusedEl = null;
                while (html.firstChild) {
                    html.removeChild(html.firstChild);
                }
            };

            var renderGrid = function() {
                var books = getLocalBookmarks();
                var sig = getBookmarksSignature(books);
                if (sig === renderedSignature) {
                    return;
                }
                renderedSignature = sig;
                destroyCards();

                if (!books.length) {
                    var emptyEl = document.createElement('div');
                    emptyEl.className = 'empty';
                    emptyEl.innerHTML = '<div class="empty__title">' + loc('Тут порожньо', 'Здесь пусто') + '</div>' +
                        '<div class="empty__descr">' + loc('Додайте фільми або серіали до закладок', 'Добавьте фильмы или сериалы в закладки') + '</div>';
                    html.appendChild(emptyEl);
                    return;
                }

                var i;
                for (i = 0; i < books.length; i++) {
                    (function(cardData) {
                        var cardObj = null;
                        try {
                            if (window.Lampa && Lampa.Maker && typeof Lampa.Maker.make === 'function') {
                                cardObj = Lampa.Maker.make('Card', cardData, { card_category: true });
                            } else if (window.Lampa && typeof Lampa.Card === 'function') {
                                cardObj = new Lampa.Card(cardData, { card_category: true });
                            }
                        } catch (eMake) {
                            cardObj = null;
                        }

                        if (cardObj && typeof cardObj.create === 'function' && typeof cardObj.render === 'function') {
                            try {
                                cardObj.onEnter = function() {
                                    openBookmarkMovieCard(cardData);
                                };
                                cardObj.onFocus = function(target) {
                                    var targetEl = (target && target.jquery) ? target[0] : target;
                                    lastFocusedEl = targetEl || null;
                                    if (scroll && typeof scroll.update === 'function' && lastFocusedEl) {
                                        try {
                                            scroll.update(window.$ ? window.$(lastFocusedEl) : lastFocusedEl, true);
                                        } catch (eScr) {
                                            /* ignore */
                                        }
                                    }
                                };
                                cardObj.create();
                                var rendered = cardObj.render();
                                var domEl = (rendered && rendered.jquery) ? rendered[0] : rendered;
                                if (domEl && domEl.nodeType === 1) {
                                    if (typeof cardObj.visible === 'function') {
                                        cardObj.visible();
                                    }
                                    html.appendChild(domEl);
                                    cardInstances.push(cardObj);
                                    cardElements.push(domEl);
                                    return;
                                }
                            } catch (eCard) {
                                /* fallback below */
                            }
                        }

                        var fallback = createNativeBookmarksCard(cardData);
                        if (fallback) {
                            html.appendChild(fallback);
                            cardElements.push(fallback);
                        }
                    })(books[i]);
                }
            };

            var compObj = {
                create: function() {
                    if (window.Lampa && typeof Lampa.Scroll === 'function') {
                        scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
                    }
                    renderGrid();
                    if (scroll && typeof scroll.append === 'function') {
                        scroll.append(window.$ ? window.$(html) : html);
                    }
                    if (compObj.activity && typeof compObj.activity.loader === 'function') {
                        compObj.activity.loader(false);
                    }
                },
                start: function() {
                    renderGrid();
                    if (compObj.activity && typeof compObj.activity.loader === 'function') {
                        compObj.activity.loader(false);
                    }
                    if (window.Lampa && Lampa.Controller) {
                        var scrollRender = (scroll && typeof scroll.render === 'function')
                            ? scroll.render()
                            : (window.$ ? window.$(html) : html);

                        Lampa.Controller.add('content', {
                            toggle: function() {
                                Lampa.Controller.collectionSet(scrollRender);
                                Lampa.Controller.collectionFocus(lastFocusedEl || (cardElements[0] || false), scrollRender);
                            },
                            left: function() {
                                if (window.Navigator && Navigator.canmove('left')) Navigator.move('left');
                                else Lampa.Controller.toggle('menu');
                            },
                            right: function() {
                                if (window.Navigator && Navigator.canmove('right')) Navigator.move('right');
                            },
                            up: function() {
                                if (window.Navigator && Navigator.canmove('up')) Navigator.move('up');
                                else Lampa.Controller.toggle('head');
                            },
                            down: function() {
                                if (window.Navigator && Navigator.canmove('down')) Navigator.move('down');
                            },
                            back: function() {
                                Lampa.Activity.backward();
                            }
                        });
                        Lampa.Controller.toggle('content');
                    }
                },
                pause: function() {},
                stop: function() {},
                render: function() {
                    if (scroll && typeof scroll.render === 'function') {
                        return scroll.render();
                    }
                    return window.$ ? window.$(html) : html;
                },
                destroy: function() {
                    destroyCards();
                    if (scroll && typeof scroll.destroy === 'function') {
                        scroll.destroy();
                    }
                    scroll = null;
                }
            };

            return compObj;
        });
    }

    function registerBookmarksRow() {
        try {
            if (!window.Lampa || !Lampa.ContentRows || typeof Lampa.ContentRows.add !== 'function') return;
            if (!getSettings().showBookmarksRow) return;

            var rowTitle = loc('Закладки', 'Закладки');
            Lampa.ContentRows.add({
                index: 1,
                name: BOOKMARKS_ROW_NAME,
                title: rowTitle,
                screen: new Array('main'),
                call: function() {
                    return function(call) {
                        if (!getSettings().showBookmarksRow) {
                            lastBookmarksShelfSignature = '';
                            call({ results: new Array(), title: rowTitle });
                            return;
                        }
                        var books = getLocalBookmarks();
                        var rowItems = books.length > 0 ? books.slice(0, 20) : new Array();
                        lastBookmarksShelfSignature = getBookmarksSignature(rowItems);

                        call({
                            results: rowItems,
                            title: rowTitle,
                            url: BOOKMARKS_ROW_NAME,
                            total_pages: rowItems.length > 0 ? 2 : 1,
                            more: openNativeBookmarksView,
                            onMore: openNativeBookmarksView
                        });

                        window.setTimeout(function() {
                            var lines = findAllBookmarksItemsLines();
                            var i;
                            for (i = 0; i < lines.length; i++) {
                                bindBookmarksMoreElements(lines[i]);
                            }
                        }, 180);
                    };
                }
            });
            logDebug('Полиця «Закладки» зареєстрована');
        } catch (err) {
            logDebug('ContentRows недоступний для Закладок:', err && err.message ? err.message : err);
        }
    }

    function syncBookmarksRowRegistration() {
        try {
            if (window.Lampa && Lampa.ContentRows && typeof Lampa.ContentRows.remove === 'function') {
                Lampa.ContentRows.remove(BOOKMARKS_ROW_NAME);
            }
        } catch (err) {
            /* ignore */
        }
        registerBookmarksRow();
        syncBookmarksShelfDom(true);
    }

    function attachBookmarksActivitySafeguard() {
        if (!window.Lampa || !Lampa.Listener || typeof Lampa.Listener.follow !== 'function') return;

        var replacePending = false;

        Lampa.Listener.follow('activity', function(e) {
            if (!e) return;

            var obj = e.object || (window.Lampa && Lampa.Activity && typeof Lampa.Activity.active === 'function' ? Lampa.Activity.active() : null);
            var comp = e.component || (obj && obj.component) || '';

            if (e.type === 'start' && comp === 'category_full' && obj && (obj.url === BOOKMARKS_ROW_NAME || (obj.title === loc('Закладки', 'Закладки') && !obj.url))) {
                if (!replacePending && window.Lampa && Lampa.Activity && typeof Lampa.Activity.replace === 'function') {
                    replacePending = true;
                    window.setTimeout(function() {
                        replacePending = false;
                        try {
                            Lampa.Activity.replace({
                                url: '',
                                title: loc('Закладки', 'Закладки'),
                                component: BOOKMARKS_FULL_COMPONENT,
                                page: 1
                            });
                        } catch (eRep) {
                            /* ignore */
                        }
                    }, 0);
                }
                return;
            }

            if (comp === 'main' && (e.type === 'start' || e.type === 'backward' || e.type === 'active')) {
                window.setTimeout(function() {
                    syncBookmarksShelfDom(false);
                }, 80);
            }
        });
    }

    function pushBookmarkToTraktWatchlist(card, isAdd) {
        if (!card || !card.id || !isTraktLoggedIn()) return;
        var settings = getSettings();
        if (!settings.syncWatchlist) return;
        var clientId = trimStr(getStorageStr('trakt_client_id', ''));
        if (!clientId) return;

        var pushKey = (isAdd ? 'add_' : 'rem_') + String(card.id);
        var now = new Date().getTime();
        if (lastWatchlistPush.key === pushKey && (now - lastWatchlistPush.ts) < 600) {
            return;
        }
        lastWatchlistPush.key = pushKey;
        lastWatchlistPush.ts = now;

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
                        Lampa.Noty.show(loc('Помилка Trakt Watchlist: HTTP ', 'Ошибка Trakt Watchlist: HTTP ') + status + errReason);
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
                        var addedAny = false;
                        for (k = 0; k < cards.length; k++) {
                            if (!isCardInLampaBookmarks(cards[k].id)) {
                                watchlistSyncLock = true;
                                try {
                                    Lampa.Favorite.add('book', cards[k]);
                                    addedAny = true;
                                } catch (errAdd) {
                                    /* ignore */
                                } finally {
                                    watchlistSyncLock = false;
                                }
                            }
                        }
                        if (addedAny) {
                            syncBookmarksShelfDom(true);
                        }
                        logDebug('Синхронізовано закладок із Trakt Watchlist:', cards.length);
                        if (showSuccessToast && window.Lampa && Lampa.Noty) {
                            Lampa.Noty.show(loc('Watchlist Trakt синхронізовано', 'Watchlist Trakt синхронизирован'));
                        }
                    });
                });
            });
        });
    }

    function attachWatchlistListeners() {
        if (!window.Lampa) return;

        var isBookFavoriteEvent = function(e) {
            if (!e) return false;
            var whereVal = e.where || e.type || e.method || '';
            if (whereVal === 'book') return true;
            if (!whereVal && e.card && e.card.id) return true;
            return false;
        };

        var onBookAdded = function(e) {
            if (!isBookFavoriteEvent(e)) return;
            var card = e.card || e.data || null;
            if (!watchlistSyncLock) {
                syncBookmarksShelfDom(true);
                if (card) {
                    pushBookmarkToTraktWatchlist(card, true);
                }
            }
        };

        var onBookRemoved = function(e) {
            if (!isBookFavoriteEvent(e)) return;
            var card = e.card || e.data || null;
            var lines = findAllBookmarksItemsLines();
            var lIdx;
            for (lIdx = 0; lIdx < lines.length; lIdx++) {
                var lineEl = lines[lIdx];
                if (card && card.id) {
                    var cards = lineEl.querySelectorAll('.card:not(.card-more)');
                    var idx;
                    for (idx = 0; idx < cards.length; idx++) {
                        if (doesDomCardMatchTarget(cards[idx], card) && cards[idx].parentNode) {
                            cards[idx].parentNode.removeChild(cards[idx]);
                        }
                    }
                }
            }
            syncBookmarksShelfDom(true);
            if (card && !watchlistSyncLock) {
                pushBookmarkToTraktWatchlist(card, false);
            }
        };

        if (Lampa.Favorite && Lampa.Favorite.listener && typeof Lampa.Favorite.listener.follow === 'function') {
            Lampa.Favorite.listener.follow('add', onBookAdded);
            Lampa.Favorite.listener.follow('added', onBookAdded);
            Lampa.Favorite.listener.follow('remove', onBookRemoved);
            Lampa.Favorite.listener.follow('removed', onBookRemoved);
        }

        window.setTimeout(function() {
            if (isTraktLoggedIn() && getSettings().syncWatchlist) {
                runTwoWayWatchlistSync(false);
            }
        }, 3000);
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
                        Lampa.Noty.show(loc('Помилка Trakt scrobble: HTTP ', 'Ошибка Trakt scrobble: HTTP ') + status + errReason);
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

    function applyImmediateScrobbleWatchedToCacheAndCard(snapshot) {
        if (!snapshot || !snapshot.movie || !snapshot.tmdbId) return;
        var isShow = Boolean(snapshot.isShow);
        var mdbJsonRef = (lastRenderedCard.data && lastRenderedCard.data.mdbJson) ? lastRenderedCard.data.mdbJson : null;
        var cacheKey = isShow ? TRAKT_WATCHED_CACHE_SHOWS : TRAKT_WATCHED_CACHE_MOVIES;
        var map = readTraktTimedMap(cacheKey);
        if (!map) map = {};

        var newVal = 1;
        if (isShow) {
            var prevVal = Number(lookupInIdMap(map, snapshot.movie, mdbJsonRef)) || 0;
            var totalEps = countTotalShowEpisodes(snapshot.movie, mdbJsonRef);
            newVal = prevVal + 1;
            if (totalEps > 0 && newVal > totalEps) {
                newVal = totalEps;
            }
        }

        updateLocalWatchedMap(isShow, snapshot.movie, mdbJsonRef, newVal);
        clearTraktProfileStatsCache();
        syncNativeLampaWatched(snapshot.movie, true);

        if (lastRenderedCard.rootEl && lastRenderedCard.movie && Number(lastRenderedCard.movie.id) === Number(snapshot.tmdbId) && lastRenderedCard.data) {
            lastRenderedCard.data.watchedStatus = buildWatchedStatusObj(newVal, lastRenderedCard.movie, lastRenderedCard.data.mdbJson || null);
            renderIntoCard(lastRenderedCard.rootEl, lastRenderedCard.movie, lastRenderedCard.data, 'status');
        }
    }

    function completeScrobbleIfNeeded(progressVal) {
        if (!scrobbleSession.active || scrobbleSession.completedSent) return;
        scrobbleSession.completedSent = true;
        var finalProgress = Math.max(80, Math.round(Number(progressVal) || 80));
        var sessionSnapshot = {
            movie: scrobbleSession.movie,
            isShow: scrobbleSession.isShow,
            tmdbId: scrobbleSession.tmdbId
        };

        sendTraktScrobble('stop', scrobbleSession, finalProgress, function() {
            applyImmediateScrobbleWatchedToCacheAndCard(sessionSnapshot);
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
                finishError(loc('Некоректний JSON від Trakt', 'Некорректный JSON от Trakt'));
                return;
            }
            finishSuccess(parsed);
        };

        xhr.ontimeout = function() {
            finishError(loc('Таймаут Trakt API', 'Таймаут Trakt API'));
        };

        xhr.onerror = function() {
            finishError(loc('Помилка мережі Trakt API', 'Ошибка сети Trakt API'));
        };

        try {
            xhr.send();
        } catch (sendErr) {
            finishError(loc('Помилка запиту Trakt', 'Ошибка запроса Trakt'));
        }
    }

    function fetchTraktRatings(movie, mdbJson, traktClientId, callback) {
        if (!traktClientId) {
            callback(createEmptyReactions(loc('Вкажіть Trakt Client ID у Налаштуваннях', 'Укажите Trakt Client ID в Настройках'), false));
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
                    callback(createEmptyReactions(loc('Немає даних розподілу Trakt', 'Нет данных распределения Trakt'), false));
                }
            }, function(errMsg) {
                if (allowSearchFallback && errMsg.indexOf('401') === -1 && errMsg.indexOf('403') === -1) {
                    searchByTmdbId();
                } else {
                    var hint = (errMsg.indexOf('401') !== -1 || errMsg.indexOf('403') !== -1)
                        ? (loc('Невірний Trakt Client ID (', 'Неверный Trakt Client ID (') + errMsg + ')')
                        : (loc('Не вдалося завантажити оцінки Trakt (', 'Не удалось загрузить оценки Trakt (') + errMsg + ')');
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
                callback(createEmptyReactions(loc('Фільм не знайдено на Trakt', 'Фильм не найден на Trakt'), false));
            }, function(errMsg) {
                var hint = (errMsg.indexOf('401') !== -1 || errMsg.indexOf('403') !== -1)
                    ? (loc('Невірний Trakt Client ID (', 'Неверный Trakt Client ID (') + errMsg + ')')
                    : (loc('Помилка пошуку Trakt (', 'Ошибка поиска Trakt (') + errMsg + ')');
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
                finishError(loc('HTTP 200 (Порожній ratings)', 'HTTP 200 (Пустой ratings)'));
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
            return '<svg class="mdb-svg" viewBox="0 0 48 48">' +
                '<rect x="2" y="2" width="44" height="44" rx="9" fill="#F5C518"/>' +
                '<text x="24" y="30" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="17" letter-spacing="-0.8" fill="#121212">IMDb</text>' +
                '</svg>';
        }

        if (sourceKey === 'trakt') {
            var gradId = 'mdb-trakt-grad-' + Math.round(score);
            return '<svg class="mdb-svg" viewBox="0 0 48 48">' +
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
            return '<svg class="mdb-svg mdb-svg-wide" viewBox="0 0 64 44">' +
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
            return '<svg class="mdb-svg mdb-svg-wide" viewBox="0 0 58 28">' +
                '<circle cx="13" cy="14" r="9.5" fill="#FF8000"/>' +
                '<circle cx="29" cy="14" r="9.5" fill="#00E054"/>' +
                '<circle cx="45" cy="14" r="9.5" fill="#40BCF4"/>' +
                '<path d="M21 7.6 A9.5 9.5 0 0 1 21 20.4 A9.5 9.5 0 0 1 21 7.6 Z" fill="#B2B500" opacity="0.65"/>' +
                '<path d="M37 7.6 A9.5 9.5 0 0 1 37 20.4 A9.5 9.5 0 0 1 37 7.6 Z" fill="#00B0B0" opacity="0.65"/>' +
                '</svg>';
        }

        if (sourceKey === 'tomatoes') {
            if (score >= 75) {
                return '<svg class="mdb-svg" viewBox="0 0 48 48">' +
                    '<circle cx="24" cy="24" r="21" fill="#F9E500" stroke="#008A2E" stroke-width="3"/>' +
                    '<circle cx="24" cy="25" r="14.5" fill="#FA320A"/>' +
                    '<path d="M24 9 L26 15 L32 13 L27 18 L24 16 L21 18 L16 13 L22 15 Z" fill="#0AC855"/>' +
                    '<rect x="11" y="19" width="26" height="10" rx="2.5" fill="#FA320A"/>' +
                    '<text x="24" y="26.5" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="7.5" fill="#FFFFFF">FRESH</text>' +
                    '</svg>';
            }
            if (score >= 60) {
                return '<svg class="mdb-svg" viewBox="0 0 48 48">' +
                    '<circle cx="24" cy="26" r="17" fill="#FA320A"/>' +
                    '<ellipse cx="18" cy="20" rx="4" ry="2.2" transform="rotate(-30 18 20)" fill="rgba(255,255,255,0.35)"/>' +
                    '<path d="M24 6 L27 13 L35 11 L28 16 L24 14 L20 16 L13 11 L21 13 Z" fill="#0AC855"/>' +
                    '</svg>';
            }
            return '<svg class="mdb-svg" viewBox="0 0 48 48">' +
                '<path d="M24 8 L29 15 L38 11 L35 20 L43 24 L35 30 L39 38 L29 35 L24 42 L19 35 L9 38 L13 30 L5 24 L13 20 L10 11 L19 15 Z" fill="#0AC855"/>' +
                '<circle cx="21" cy="22" r="2.2" fill="#065A26"/>' +
                '<circle cx="28" cy="27" r="1.8" fill="#065A26"/>' +
                '</svg>';
        }

        if (sourceKey === 'popcorn') {
            if (score >= 60) {
                return '<svg class="mdb-svg" viewBox="0 0 48 48">' +
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
            return '<svg class="mdb-svg" viewBox="0 0 48 48">' +
                '<polygon points="13,18 35,18 32,42 16,42" fill="#89A894"/>' +
                '<polygon points="17,18 22,18 21,42 18,42" fill="#3B6E4C"/>' +
                '<polygon points="26,18 31,18 30,42 27,42" fill="#3B6E4C"/>' +
                '<circle cx="20" cy="15" r="4.5" fill="#C9D6B8"/>' +
                '<circle cx="28" cy="16" r="4.5" fill="#B6C7A3"/>' +
                '</svg>';
        }

        if (sourceKey === 'metacritic') {
            return '<svg class="mdb-svg" viewBox="0 0 48 48">' +
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

    function formatRatingParts(sourceKey, r, ratingsFormat) {
        var val = Number(r.value);
        var fmt = ratingsFormat || 'full';

        if (fmt === 'scale_10') {
            var normalized = val;
            if (sourceKey === 'letterboxd') {
                normalized = val * 2;
            } else if (sourceKey !== 'imdb') {
                normalized = val / 10;
            }
            return { score: normalized.toFixed(1), denom: '' };
        }

        var showDenom = (fmt === 'full' || fmt === 'no_votes');

        if (sourceKey === 'imdb') {
            return { score: val.toFixed(1), denom: showDenom ? '/10' : '' };
        }
        if (sourceKey === 'trakt') {
            return { score: String(Math.round(val)), denom: showDenom ? '%' : '' };
        }
        if (sourceKey === 'tmdb') {
            return { score: String(Math.round(val)), denom: showDenom ? '/100' : '' };
        }
        if (sourceKey === 'letterboxd') {
            return { score: val.toFixed(1), denom: showDenom ? '/5' : '' };
        }
        if (sourceKey === 'tomatoes') {
            return { score: String(Math.round(val)), denom: showDenom ? '%' : '' };
        }
        if (sourceKey === 'popcorn') {
            return { score: String(Math.round(val)), denom: showDenom ? '%' : '' };
        }
        if (sourceKey === 'metacritic') {
            return { score: String(Math.round(val)), denom: showDenom ? '/100' : '' };
        }
        return { score: String(val), denom: '' };
    }

    function getUserLocalVote(mediaVoteKey) {
        if (!window.Lampa || !Lampa.Storage) return '';
        return getStorageStr(VOTE_PREFIX + mediaVoteKey, '');
    }

    function getUserVoteTimestamp(mediaVoteKey) {
        if (!window.Lampa || !Lampa.Storage) return 0;
        return Number(getStorageStr(VOTE_PREFIX + mediaVoteKey + '_ts', '0')) || 0;
    }

    function setUserLocalVote(mediaVoteKey, reactionKey, stampTime) {
        if (!window.Lampa || !Lampa.Storage) return;
        if (reactionKey) {
            Lampa.Storage.set(VOTE_PREFIX + mediaVoteKey, reactionKey);
        } else {
            safeStorageRemove(VOTE_PREFIX + mediaVoteKey);
        }
        if (stampTime) {
            Lampa.Storage.set(VOTE_PREFIX + mediaVoteKey + '_ts', String(new Date().getTime()));
        }
    }

    function persistReactionClickState(movie, data, prevVote, nextVote) {
        var isShow = Boolean(movie.first_air_date);
        var type = isShow ? 'show' : 'movie';
        var mediaVoteKey = type + '_' + movie.id;
        var cacheKey = CACHE_PREFIX + mediaVoteKey;

        if (data.reactions) {
            if (prevVote && data.reactions[prevVote] !== undefined) {
                data.reactions[prevVote] = Math.max(0, (Number(data.reactions[prevVote]) || 0) - 1);
            }
            if (nextVote && data.reactions[nextVote] !== undefined) {
                data.reactions[nextVote] = (Number(data.reactions[nextVote]) || 0) + 1;
            }
        }

        data.bakedVote = nextVote;
        data.userTraktVote = nextVote;

        setUserLocalVote(mediaVoteKey, nextVote, true);
        updateLocalTraktSyncMap(isShow, movie, data.mdbJson || null, nextVote, true);

        writeCache(cacheKey, {
            ratings: data.ratings,
            reactions: data.reactions,
            mdbJson: data.mdbJson || null,
            apiError: data.apiError || '',
            userVote: nextVote
        });
    }

    function getEmojiImageUrl(packName, hexCode) {
        if (!packName || packName === 'unicode') return '';
        var base = EMOJI_PACK_BASES[packName];
        if (!base) return '';
        return base + hexCode + '.png';
    }

    function buildSortedPillsList(reactions, activeVote, bakedVote, emojiPack) {
        var list = new Array();
        var i;
        var baked = bakedVote || '';
        for (i = 0; i < REACTION_DEFS.length; i++) {
            var def = REACTION_DEFS[i];
            var baseCount = Number(reactions[def.key]) || 0;
            var isSelected = (activeVote === def.key);
            var delta = 0;

            if (isSelected && baked !== def.key) {
                delta = 1;
            } else if (!isSelected && baked === def.key) {
                delta = -1;
            }

            list.push({
                key: def.key,
                emoji: def.emoji,
                png: getEmojiImageUrl(emojiPack, def.hex),
                barColor: def.barColor,
                label: getReactionLabel(def),
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
            '.full-start__tagline:empty, .full-start-new__tagline:empty, .full-start__description:empty, .full-start-new__description:empty {' +
            '  display: none !important;' +
            '  margin: 0 !important;' +
            '}' +

            '.mdb-reactions-wrapper {' +
            '  position: relative;' +
            '  z-index: 15;' +
            '  pointer-events: auto !important;' +
            '  display: block !important;' +
            '  width: 100%;' +
            '  margin: 0.45em 0 0.85em 0;' +
            '  box-sizing: border-box;' +
            '}' +
            '.mdb-slot-status:empty, .mdb-slot-ratings:empty, .mdb-slot-pills:empty {' +
            '  display: none !important;' +
            '  margin: 0 !important;' +
            '}' +
            '.mdb-slot-ratings + .mdb-slot-pills {' +
            '  margin-top: 0.78em;' +
            '}' +

            'body.cardify .mdb-reactions-wrapper, .cardify .mdb-reactions-wrapper, body.cardify .mdb-pills-row, .cardify .mdb-pills-row {' +
            '  overflow: visible !important;' +
            '}' +
            '.mdb-pills-row .mdb-pill-btn:first-child .mdb-tooltip,' +
            '.mdb-pills-row .mdb-pill-btn:first-child.focus .mdb-tooltip,' +
            '.mdb-pills-row .mdb-pill-btn:first-child:hover .mdb-tooltip,' +
            '.mdb-pills-row .mdb-pill-btn:first-child .mdb-tooltip::before,' +
            '.mdb-pills-row .mdb-pill-btn:first-child .mdb-tooltip::after {' +
            '  left: 0 !important;' +
            '  right: auto !important;' +
            '  transform: none !important;' +
            '}' +

            '.mdb-watched-row {' +
            '  display: flex;' +
            '  flex-wrap: wrap;' +
            '  align-items: center;' +
            '  gap: 0.45em;' +
            '  margin-top: 0;' +
            '  margin-bottom: 0.55em;' +
            '}' +
            '.mdb-watched-row:empty {' +
            '  display: none !important;' +
            '  margin: 0 !important;' +
            '}' +
            '.mdb-watched-badge {' +
            '  display: inline-flex;' +
            '  align-items: center;' +
            '  gap: 0.35em;' +
            '  padding: 0.2em 0.72em;' +
            '  border-radius: 999px;' +
            '  font-size: 0.86em;' +
            '  font-weight: 600;' +
            '  line-height: 1.15;' +
            '  user-select: none;' +
            '}' +
            '.mdb-watched-badge.is-watched {' +
            '  background: rgba(46, 204, 113, 0.18);' +
            '  border: 0.08em solid rgba(46, 204, 113, 0.48);' +
            '  color: #69f0ae;' +
            '}' +
            '.mdb-watched-badge.is-watched-full {' +
            '  background: rgba(46, 204, 113, 0.28);' +
            '  border: 0.08em solid rgba(46, 204, 113, 0.72);' +
            '  color: #b9f6ca;' +
            '}' +
            '.mdb-awards-badge {' +
            '  display: inline-flex;' +
            '  align-items: center;' +
            '  gap: 0.35em;' +
            '  padding: 0.2em 0.75em;' +
            '  border-radius: 999px;' +
            '  font-size: 0.86em;' +
            '  font-weight: 700;' +
            '  line-height: 1.15;' +
            '  user-select: none;' +
            '  background: linear-gradient(135deg, rgba(255, 193, 7, 0.26), rgba(212, 175, 55, 0.16));' +
            '  border: 1.5px solid rgba(255, 215, 0, 0.65);' +
            '  color: #ffe082;' +
            '  box-shadow: 0 2px 10px rgba(255, 193, 7, 0.25);' +
            '  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);' +
            '}' +

            '.mdb-trakt-watched-btn {' +
            '  position: relative;' +
            '  z-index: 15;' +
            '  pointer-events: auto !important;' +
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
            '.mdb-trakt-watched-btn.focus, .mdb-trakt-watched-btn:hover {' +
            '  background: #ffffff !important;' +
            '  color: #000000 !important;' +
            '}' +
            '.mdb-trakt-watched-btn.focus > span, .mdb-trakt-watched-btn:hover > span {' +
            '  display: inline-block;' +
            '  margin-left: 0.45em;' +
            '  color: #000000;' +
            '}' +

            '.mdb-pills-row {' +
            '  position: relative;' +
            '  z-index: 15;' +
            '  pointer-events: auto !important;' +
            '  display: flex !important;' +
            '  flex-wrap: wrap !important;' +
            '  align-items: center !important;' +
            '  gap: 0.6em;' +
            '  margin: 0;' +
            '}' +

            '.mdb-pill {' +
            '  position: relative;' +
            '  pointer-events: auto !important;' +
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
            '  border: 0.08em solid rgba(255, 255, 255, 0.12);' +
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
            '  border: 0.11em solid rgba(255, 255, 255, 0.28);' +
            '}' +
            '.mdb-style-compact .mdb-pill {' +
            '  background: rgba(255, 255, 255, 0.1);' +
            '  padding: 0.28em 0.72em;' +
            '  font-size: 0.92em;' +
            '  gap: 0.35em;' +
            '}' +
            '.mdb-style-neon .mdb-pill {' +
            '  background: rgba(14, 16, 22, 0.65);' +
            '  backdrop-filter: blur(8px);' +
            '  -webkit-backdrop-filter: blur(8px);' +
            '}' +
            '.mdb-style-neon .mdb-pill[data-reaction-key="masterpiece"] { border-color: rgba(255, 94, 20, 0.58); }' +
            '.mdb-style-neon .mdb-pill[data-reaction-key="worth"] { border-color: rgba(46, 204, 113, 0.58); }' +
            '.mdb-style-neon .mdb-pill[data-reaction-key="once"] { border-color: rgba(241, 196, 15, 0.58); }' +
            '.mdb-style-neon .mdb-pill[data-reaction-key="boring"] { border-color: rgba(52, 152, 219, 0.58); }' +
            '.mdb-style-neon .mdb-pill[data-reaction-key="weak"] { border-color: rgba(231, 76, 60, 0.58); }' +
            '.mdb-style-graphite .mdb-pill {' +
            '  background: #1c1e24;' +
            '  border: 0.08em solid rgba(255, 255, 255, 0.08);' +
            '  box-shadow: inset 0 0.06em 0 rgba(255, 255, 255, 0.14), 0 0.25em 0.75em rgba(0, 0, 0, 0.45);' +
            '}' +
            '.mdb-style-crystal .mdb-pill {' +
            '  background: rgba(255, 255, 255, 0.08);' +
            '  border-color: transparent;' +
            '  backdrop-filter: blur(6px);' +
            '  -webkit-backdrop-filter: blur(6px);' +
            '}' +
            '.mdb-style-imax .mdb-pill {' +
            '  background: rgba(15, 35, 65, 0.55);' +
            '  border: 0.08em solid rgba(100, 181, 246, 0.35);' +
            '  backdrop-filter: blur(8px);' +
            '  -webkit-backdrop-filter: blur(8px);' +
            '}' +
            '.mdb-style-imax .mdb-pill.focus, .mdb-style-imax .mdb-pill:hover {' +
            '  background: rgba(25, 60, 110, 0.72);' +
            '  border-color: rgba(144, 202, 249, 0.9);' +
            '  box-shadow: 0 0 1em rgba(66, 165, 245, 0.48);' +
            '}' +
            '.mdb-style-gold .mdb-pill {' +
            '  background: rgba(18, 16, 14, 0.74);' +
            '  border: 0.08em solid rgba(255, 215, 0, 0.35);' +
            '  box-shadow: 0 0.15em 0.65em rgba(0, 0, 0, 0.35);' +
            '}' +
            '.mdb-style-contrast .mdb-pill {' +
            '  background: rgba(0, 0, 0, 0.72);' +
            '  border: 1px solid rgba(255, 255, 255, 0.28);' +
            '}' +
            '.mdb-style-gradient .mdb-pill {' +
            '  background: linear-gradient(135deg, rgba(25, 28, 36, 0.85), rgba(255, 255, 255, 0.12));' +
            '  border: 0.08em solid rgba(255, 255, 255, 0.14);' +
            '  box-shadow: 0 0.25em 0.85em rgba(0, 0, 0, 0.38);' +
            '}' +

            '.mdb-pill.focus, .mdb-pill:hover {' +
            '  transform: translateY(-0.08em) scale(1.06);' +
            '  background: rgba(255, 255, 255, 0.24);' +
            '  border-color: rgba(255, 255, 255, 0.85);' +
            '  box-shadow: 0 0.25em 0.9em rgba(0, 0, 0, 0.35);' +
            '}' +

            '.mdb-pill.active[data-reaction-key="masterpiece"] {' +
            '  background: rgba(255, 107, 0, 0.38) !important;' +
            '  border: 0.14em solid #ff9500 !important;' +
            '  box-shadow: 0 0 1em rgba(255, 107, 0, 0.55) !important;' +
            '}' +
            '.mdb-pill.active[data-reaction-key="worth"] {' +
            '  background: rgba(46, 204, 113, 0.35) !important;' +
            '  border: 0.14em solid #2ecc71 !important;' +
            '  box-shadow: 0 0 1em rgba(46, 204, 113, 0.5) !important;' +
            '}' +
            '.mdb-pill.active[data-reaction-key="once"] {' +
            '  background: rgba(241, 196, 15, 0.32) !important;' +
            '  border: 0.14em solid #f1c40f !important;' +
            '  box-shadow: 0 0 1em rgba(241, 196, 15, 0.45) !important;' +
            '}' +
            '.mdb-pill.active[data-reaction-key="boring"] {' +
            '  background: rgba(52, 152, 219, 0.35) !important;' +
            '  border: 0.14em solid #3498db !important;' +
            '  box-shadow: 0 0 1em rgba(52, 152, 219, 0.5) !important;' +
            '}' +
            '.mdb-pill.active[data-reaction-key="weak"] {' +
            '  background: rgba(231, 76, 60, 0.35) !important;' +
            '  border: 0.14em solid #e74c3c !important;' +
            '  box-shadow: 0 0 1em rgba(231, 76, 60, 0.5) !important;' +
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
            '  filter: drop-shadow(0 0 0.4em rgba(255, 94, 20, 0.65));' +
            '}' +
            '.mdb-emoji-glow .mdb-pill[data-reaction-key="worth"] .mdb-pill-icon {' +
            '  filter: drop-shadow(0 0 0.4em rgba(255, 204, 0, 0.55));' +
            '}' +
            '.mdb-emoji-glow .mdb-pill[data-reaction-key="once"] .mdb-pill-icon {' +
            '  filter: drop-shadow(0 0 0.4em rgba(255, 193, 7, 0.45));' +
            '}' +
            '.mdb-emoji-glow .mdb-pill[data-reaction-key="boring"] .mdb-pill-icon {' +
            '  filter: drop-shadow(0 0 0.4em rgba(100, 149, 237, 0.55));' +
            '}' +
            '.mdb-emoji-glow .mdb-pill[data-reaction-key="weak"] .mdb-pill-icon {' +
            '  filter: drop-shadow(0 0 0.4em rgba(181, 115, 65, 0.55));' +
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
            '  height: 0.14em;' +
            '  transition: width 0.3s ease;' +
            '}' +

            '.mdb-pill-tooltip {' +
            '  position: absolute;' +
            '  bottom: calc(100% + 0.45em);' +
            '  left: 50%;' +
            '  transform: translateX(-50%) translateY(0.25em);' +
            '  background: rgba(20, 22, 27, 0.96);' +
            '  color: #ffffff;' +
            '  border: 0.08em solid rgba(255, 255, 255, 0.18);' +
            '  border-radius: 0.4em;' +
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
            '  gap: 0.7em 1.35em;' +
            '  width: 100%;' +
            '}' +

            '.mdb-rating-item {' +
            '  display: inline-flex;' +
            '  flex-direction: column;' +
            '  align-items: flex-start;' +
            '  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;' +
            '}' +

            '.mdb-ratings-style-glass .mdb-rating-item,' +
            '.mdb-ratings-style-solid .mdb-rating-item,' +
            '.mdb-ratings-style-outline .mdb-rating
            '.mdb-ratings-style-compact .mdb-rating-item,' +
            '.mdb-ratings-style-neon .mdb-rating-item,' +
            '.mdb-ratings-style-graphite .mdb-rating-item,' +
            '.mdb-ratings-style-crystal .mdb-rating-item,' +
            '.mdb-ratings-style-imax .mdb-rating-item,' +
            '.mdb-ratings-style-gold .mdb-rating-item,' +
            '.mdb-ratings-style-contrast .mdb-rating-item,' +
            '.mdb-ratings-style-gradient .mdb-rating-item {' +
            '  padding: 0.38em 0.74em;' +
            '  border-radius: 0.78em;' +
            '  border: 0.08em solid rgba(255, 255, 255, 0.12);' +
            '}' +
            '.mdb-ratings-style-glass .mdb-rating-item {' +
            '  background: rgba(255, 255, 255, 0.1);' +
            '  backdrop-filter: blur(8px);' +
            '  -webkit-backdrop-filter: blur(8px);' +
            '}' +
            '.mdb-ratings-style-solid .mdb-rating-item {' +
            '  background: #23252c;' +
            '  border-color: rgba(255, 255, 255, 0.1);' +
            '}' +
            '.mdb-ratings-style-outline .mdb-rating-item {' +
            '  background: rgba(0, 0, 0, 0.18);' +
            '  border: 0.11em solid rgba(255, 255, 255, 0.28);' +
            '}' +
            '.mdb-ratings-style-compact .mdb-rating-item {' +
            '  background: rgba(255, 255, 255, 0.09);' +
            '  padding: 0.25em 0.56em;' +
            '  border-radius: 0.6em;' +
            '}' +
            '.mdb-ratings-style-neon .mdb-rating-item {' +
            '  background: rgba(14, 16, 22, 0.65);' +
            '  backdrop-filter: blur(8px);' +
            '  -webkit-backdrop-filter: blur(8px);' +
            '}' +
            '.mdb-ratings-style-neon .mdb-rating-item.mdb-source-imdb { border-color: rgba(245, 197, 24, 0.55); }' +
            '.mdb-ratings-style-neon .mdb-rating-item.mdb-source-trakt { border-color: rgba(237, 28, 36, 0.55); }' +
            '.mdb-ratings-style-neon .mdb-rating-item.mdb-source-tmdb { border-color: rgba(1, 180, 228, 0.55); }' +
            '.mdb-ratings-style-neon .mdb-rating-item.mdb-source-letterboxd { border-color: rgba(0, 224, 84, 0.55); }' +
            '.mdb-ratings-style-neon .mdb-rating-item.mdb-source-tomatoes { border-color: rgba(250, 50, 10, 0.55); }' +
            '.mdb-ratings-style-neon .mdb-rating-item.mdb-source-popcorn { border-color: rgba(255, 204, 0, 0.55); }' +
            '.mdb-ratings-style-neon .mdb-rating-item.mdb-source-metacritic { border-color: rgba(212, 175, 55, 0.55); }' +
            '.mdb-ratings-style-graphite .mdb-rating-item {' +
            '  background: #1c1e24;' +
            '  border-color: rgba(255, 255, 255, 0.08);' +
            '  box-shadow: inset 0 0.06em 0 rgba(255, 255, 255, 0.14), 0 0.25em 0.75em rgba(0, 0, 0, 0.45);' +
            '}' +
            '.mdb-ratings-style-crystal .mdb-rating-item {' +
            '  background: rgba(255, 255, 255, 0.08);' +
            '  border-color: transparent;' +
            '  backdrop-filter: blur(6px);' +
            '  -webkit-backdrop-filter: blur(6px);' +
            '}' +
            '.mdb-ratings-style-imax .mdb-rating-item {' +
            '  background: rgba(15, 35, 65, 0.55);' +
            '  border-color: rgba(100, 181, 246, 0.35);' +
            '  backdrop-filter: blur(8px);' +
            '  -webkit-backdrop-filter: blur(8px);' +
            '}' +
            '.mdb-ratings-style-gold .mdb-rating-item {' +
            '  background: rgba(18, 16, 14, 0.74);' +
            '  border-color: rgba(255, 215, 0, 0.35);' +
            '  box-shadow: 0 0.15em 0.65em rgba(0, 0, 0, 0.35);' +
            '}' +
            '.mdb-ratings-style-contrast .mdb-rating-item {' +
            '  background: rgba(0, 0, 0, 0.72);' +
            '  border: 1px solid rgba(255, 255, 255, 0.28);' +
            '}' +
            '.mdb-ratings-style-gradient .mdb-rating-item {' +
            '  background: linear-gradient(135deg, rgba(25, 28, 36, 0.85), rgba(255, 255, 255, 0.12));' +
            '  border-color: rgba(255, 255, 255, 0.14);' +
            '  box-shadow: 0 0.25em 0.85em rgba(0, 0, 0, 0.38);' +
            '}' +

            '.mdb-ratings-format-minimal_row .mdb-rating-item {' +
            '  background: transparent !important;' +
            '  border: none !important;' +
            '  box-shadow: none !important;' +
            '  backdrop-filter: none !important;' +
            '  -webkit-backdrop-filter: none !important;' +
            '  padding: 0 !important;' +
            '  border-radius: 0 !important;' +
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
            '  width: 2.0em;' +
            '  height: 2.0em;' +
            '}' +
            '.mdb-source-tmdb .mdb-svg-wide {' +
            '  width: 2.5em;' +
            '  height: 1.875em;' +
            '}' +
            '.mdb-source-letterboxd .mdb-svg-wide {' +
            '  width: 2.375em;' +
            '  height: 1.375em;' +
            '}' +
            '.mdb-text-badge {' +
            '  display: inline-block;' +
            '  padding: 0.22em 0.52em;' +
            '  border-radius: 0.35em;' +
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
            '  border-radius: 0.4em;' +
            '  font-size: 0.84em;' +
            '  color: rgba(255, 255, 255, 0.65);' +
            '  background: rgba(255, 255, 255, 0.07);' +
            '  border: 0.08em solid rgba(255, 255, 255, 0.16);' +
            '}' +

            '.mdb-error-badge {' +
            '  display: inline-block;' +
            '  padding: 0.38em 0.75em;' +
            '  border-radius: 0.4em;' +
            '  font-size: 0.86em;' +
            '  font-weight: 600;' +
            '  color: #ff8a65;' +
            '  background: rgba(255, 82, 82, 0.16);' +
            '  border: 0.08em solid rgba(255, 110, 64, 0.48);' +
            '  line-height: 1.35;' +
            '  word-break: break-word;' +
            '}' +

            '.mdb-trakt-profile-stats {' +
            '  margin-top: 0.45em;' +
            '  font-size: 0.88em;' +
            '  font-weight: 600;' +
            '  color: #69f0ae;' +
            '  line-height: 1.35;' +
            '  letter-spacing: 0.01em;' +
            '}' +
            '.settings-param.focus .mdb-trakt-profile-stats {' +
            '  color: #1b5e20;' +
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

    function createTopStatusRow(data, settings) {
        var row = document.createElement('div');
        row.className = 'mdb-watched-row';
        row.style.fontSize = settings.scaleBadges + 'em';

        var ru = isRuLang();

        if (settings.showWatchedBadge && isTraktLoggedIn() && data.watchedStatus) {
            var ws = data.watchedStatus;
            var badgeText = '';
            var badgeClass = '';

            if (ws.isShow) {
                if (ws.watchedEpisodes > 0) {
                    if (ws.totalEpisodes > 0) {
                        badgeText = (ru ? '✓ Просмотрено ' : '✓ Переглянуто ') +
                            ws.watchedEpisodes + (ru ? ' из ' : ' з ') +
                            ws.totalEpisodes + (ru ? ' серий' : ' серій');
                        badgeClass = (ws.watchedEpisodes >= ws.totalEpisodes) ? 'is-watched-full' : 'is-watched';
                    } else {
                        badgeText = (ru ? '✓ Просмотрено ' : '✓ Переглянуто ') +
                            ws.watchedEpisodes + (ru ? ' серий' : ' серій');
                        badgeClass = 'is-watched';
                    }
                }
            } else if (ws.watched) {
                badgeText = ru ? '✓ Просмотрено' : '✓ Переглянуто';
                badgeClass = 'is-watched';
            }

            if (badgeText) {
                var watchedBadge = document.createElement('div');
                watchedBadge.className = 'mdb-watched-badge ' + badgeClass;
                watchedBadge.textContent = badgeText;
                row.appendChild(watchedBadge);
            }
        }

        if (settings.showAwards && data.mdbJson) {
            var awardInfo = parseMdblistAwards(data.mdbJson);
            if (awardInfo && awardInfo.label) {
                var awardsBadge = document.createElement('div');
                awardsBadge.className = 'mdb-awards-badge';
                awardsBadge.textContent = awardInfo.label;
                if (awardInfo.tooltip) {
                    awardsBadge.setAttribute('title', awardInfo.tooltip);
                }
                row.appendChild(awardsBadge);
            }
        }

        if (row.children.length === 0) {
            return null;
        }
        return row;
    }

    function buildRatingsRowNode(data, settings) {
        var ratingsRow = document.createElement('div');
        ratingsRow.className = 'mdb-ratings-row';
        ratingsRow.style.fontSize = settings.scaleRatings + 'em';
        var renderedRatings = 0;

        if (data.ratingsLoading) {
            var loadEl = document.createElement('div');
            loadEl.className = 'mdb-loading-badge';
            loadEl.textContent = loc('Завантаження рейтингів MDBList...', 'Загрузка рейтингов MDBList...');
            ratingsRow.appendChild(loadEl);
            return ratingsRow;
        }

        if (data.apiError === 'NO_KEY') {
            var hintEl = document.createElement('div');
            hintEl.className = 'mdb-hint-badge';
            hintEl.textContent = loc('Вкажіть MDBList API Key у Налаштуваннях', 'Укажите MDBList API Key в Настройках');
            ratingsRow.appendChild(hintEl);
            return ratingsRow;
        }

        if (data.apiError) {
            var errEl = document.createElement('div');
            errEl.className = 'mdb-error-badge';
            errEl.textContent = 'MDBList Error: ' + data.apiError;
            ratingsRow.appendChild(errEl);
            return ratingsRow;
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

            var showVotesSub = (settings.ratingsFormat === 'full');

            for (rIdx = 0; rIdx < PLATFORM_ORDER.length; rIdx++) {
                var srcKey = PLATFORM_ORDER[rIdx];
                if (!isPlatformEnabled(srcKey, settings)) continue;

                var ratingObj = ratingMap[srcKey];
                if (!ratingObj || ratingObj.value === null || ratingObj.value === undefined) continue;
                var numVal = Number(ratingObj.value);
                if (isNaN(numVal) || numVal <= 0) continue;

                var parts = formatRatingParts(srcKey, ratingObj, settings.ratingsFormat);
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

                scoreGroup.appendChild(scoreValEl);

                if (parts.denom) {
                    var scoreDenomEl = document.createElement('span');
                    scoreDenomEl.className = 'mdb-score-denom';
                    scoreDenomEl.textContent = parts.denom;
                    scoreGroup.appendChild(scoreDenomEl);
                }

                topEl.appendChild(iconWrap);
                topEl.appendChild(scoreGroup);
                itemEl.appendChild(topEl);

                var votesNum = Number(ratingObj.votes) || 0;
                if (showVotesSub && votesNum > 0) {
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
                return ratingsRow;
            }
        }

        return null;
    }

    function buildPillsRowNode(data, movie, settings) {
        if (!settings.showPills || !data.reactions) return null;

        var type = movie.first_air_date ? 'show' : 'movie';
        var mediaVoteKey = type + '_' + movie.id;
        var pillsRow = document.createElement('div');
        pillsRow.className = 'mdb-pills-row lampa-pill-row';
        pillsRow.style.fontSize = settings.scalePills + 'em';
        var lastTapTs = 0;

        var renderSortedPills = function(focusKey) {
            while (pillsRow.firstChild) {
                pillsRow.removeChild(pillsRow.firstChild);
            }

            var loggedIn = isTraktLoggedIn();
            var activeVote = loggedIn
                ? (data.userTraktVote !== undefined ? data.userTraktVote : '')
                : getUserLocalVote(mediaVoteKey);
            var bakedVote = data.bakedVote || '';
            var sortedPills = buildSortedPillsList(data.reactions, activeVote, bakedVote, settings.emojiPack);
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

                    if (item.png) {
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

                        var isLogged = isTraktLoggedIn();
                        var prevVote = isLogged
                            ? (data.userTraktVote !== undefined ? data.userTraktVote : '')
                            : getUserLocalVote(mediaVoteKey);
                        var nextVote = (prevVote === item.key) ? '' : item.key;

                        logDebug('Натиснуто пігулку:', item.key, 'loggedIn=' + isLogged, 'prev=' + prevVote, 'next=' + nextVote);

                        persistReactionClickState(movie, data, prevVote, nextVote);

                        if (isLogged) {
                            syncReactionToTrakt(movie, data.mdbJson || null, nextVote);
                        }

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
        return pillsRow;
    }

    function getWatchedActionSvg(isWatched) {
        if (isWatched) {
            return '<svg viewBox="0 0 24 24" fill="currentColor">' +
                '<path fill-rule="evenodd" d="M12 5C6.5 5 2.1 8.4 1 12c1.1 3.6 5.5 7 11 7s9.9-3.4 11-7c-1.1-3.6-5.5-7-11-7zM8.3 11.7L11.0 14.3L15.7 9.3L17.0 10.5L11.0 16.8L7.0 12.9Z"/>' +
                '</svg>';
        }
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>' +
            '<circle cx="12" cy="12" r="3"/>' +
            '</svg>';
    }

    function syncWatchedActionButton(rootEl, movie, data) {
        if (!rootEl || !rootEl.querySelector) return;

        var buttonsContainer = rootEl.querySelector('.full-start-new__buttons, .full-start__buttons');
        if (!buttonsContainer) return;

        var existingBtn = buttonsContainer.querySelector('.mdb-trakt-watched-btn');

        if (!isTraktLoggedIn()) {
            if (existingBtn && existingBtn.parentNode) {
                existingBtn.parentNode.removeChild(existingBtn);
            }
            return;
        }

        var ws = data.watchedStatus;
        var isCurrentlyWatched = Boolean(ws && (ws.isShow ? (ws.watchedEpisodes > 0) : ws.watched));
        var innerMarkup = getWatchedActionSvg(isCurrentlyWatched) + '<span>' + loc('Переглянуто', 'Просмотрено') + '</span>';

        if (existingBtn) {
            existingBtn._mdbRef = { rootEl: rootEl, movie: movie, data: data };
            existingBtn.innerHTML = innerMarkup;
            return;
        }

        var btn = document.createElement('div');
        btn.className = 'full-start__button selector mdb-trakt-watched-btn';
        btn._mdbRef = { rootEl: rootEl, movie: movie, data: data };
        btn.innerHTML = innerMarkup;

        var lastBtnTapTs = 0;
        var handleBtnClick = function(ev) {
            if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
            var now = new Date().getTime();
            if (now - lastBtnTapTs < 350) return;
            lastBtnTapTs = now;

            var ref = btn._mdbRef || { rootEl: rootEl, movie: movie, data: data };
            var liveRoot = ref.rootEl;
            var liveMovie = ref.movie;
            var liveData = ref.data;

            var isShow = Boolean(liveMovie.first_air_date);
            if (isShow) {
                openShowWatchedMenu(liveRoot, liveMovie, liveData);
                return;
            }

            var curWs = liveData.watchedStatus;
            var currentlyMarked = Boolean(curWs && curWs.watched);
            var targetMark = !currentlyMarked;

            toggleWatchedOnTrakt(liveMovie, liveData.mdbJson || null, targetMark, function(ok, newVal) {
                if (!ok) return;
                if (!liveData.watchedStatus) {
                    liveData.watchedStatus = buildWatchedStatusObj(newVal, liveMovie, liveData.mdbJson || null);
                } else {
                    liveData.watchedStatus.watched = Boolean(targetMark);
                }

                renderIntoCard(liveRoot, liveMovie, liveData, 'status');

                var newBtn = liveRoot.querySelector('.mdb-trakt-watched-btn');
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

    function ensureWrapperMounted(rootEl, settings) {
        var wrapper = rootEl.querySelector('.mdb-reactions-wrapper');
        var desiredClass = 'mdb-reactions-wrapper mdb-style-' + settings.pillStyle +
            ' mdb-ratings-style-' + settings.ratingsStyle +
            ' mdb-ratings-format-' + settings.ratingsFormat +
            ' mdb-badges-' + settings.badgeStyle +
            (settings.emojiGlow ? ' mdb-emoji-glow' : '') +
            (settings.emojiAnim ? ' mdb-emoji-anim' : '');

        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = desiredClass;

            var slotStatus = document.createElement('div');
            slotStatus.className = 'mdb-slot-status';
            var slotRatings = document.createElement('div');
            slotRatings.className = 'mdb-slot-ratings';
            var slotPills = document.createElement('div');
            slotPills.className = 'mdb-slot-pills';

            wrapper.appendChild(slotStatus);
            wrapper.appendChild(slotRatings);
            wrapper.appendChild(slotPills);

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
        } else {
            wrapper.className = desiredClass;
        }

        return wrapper;
    }

    function replaceSlotContent(slotEl, newNode) {
        if (!slotEl) return;
        while (slotEl.firstChild) {
            slotEl.removeChild(slotEl.firstChild);
        }
        if (newNode) {
            slotEl.appendChild(newNode);
        }
    }

    function renderIntoCard(rootEl, movie, data, section) {
        if (!rootEl || !rootEl.querySelector) {
            logDebug('Кореневий DOM елемент картки не знайдено');
            return false;
        }

        var settings = getSettings();
        hideDefaultCardRates(rootEl);

        lastRenderedCard.rootEl = rootEl;
        lastRenderedCard.movie = movie;
        lastRenderedCard.data = data;

        var wrapper = ensureWrapperMounted(rootEl, settings);
        var mode = section || 'all';

        if (mode === 'all' || mode === 'status') {
            replaceSlotContent(wrapper.querySelector('.mdb-slot-status'), createTopStatusRow(data, settings));
        }

        if (mode === 'all' || mode === 'ratings') {
            replaceSlotContent(wrapper.querySelector('.mdb-slot-ratings'), buildRatingsRowNode(data, settings));
        }

        if (mode === 'all' || mode === 'pills') {
            replaceSlotContent(wrapper.querySelector('.mdb-slot-pills'), buildPillsRowNode(data, movie, settings));
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
            name: loc('Trakt & Рейтинги', 'Trakt & Рейтинги'),
            icon: sidebarIcon
        });

        authButtonFieldRef = {
            name: getAuthButtonTitle(),
            description: loc(
                'Двостороння синхронізація реакцій, переглядів та скробблінг із профілем Trakt',
                'Двусторонняя синхронизация реакций, просмотров и скробблинг с профилем Trakt'
            )
        };

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'trakt_auth_btn',
                type: 'button'
            },
            field: authButtonFieldRef,
            onChange: function() {
                if (isTraktLoggedIn()) {
                    clearTraktTokens();
                    refreshSettingsAuthUi();
                    if (window.Lampa && Lampa.Noty) {
                        Lampa.Noty.show(loc('Ви вийшли з акаунта Trakt', 'Вы вышли из аккаунта Trakt'));
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
                placeholder: loc('Вставте ваш Trakt Client ID', 'Вставьте ваш Trakt Client ID'),
                default: ''
            },
            field: {
                name: 'Trakt Client ID',
                description: loc(
                    'Client ID застосунку (PKCE) з developer.trakt.tv для реакцій та авторизації',
                    'Client ID приложения (PKCE) с developer.trakt.tv для реакций и авторизации'
                )
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
                placeholder: loc('Вставте ваш MDBList API Key', 'Вставьте ваш MDBList API Key'),
                default: ''
            },
            field: {
                name: 'MDBList API Key',
                description: loc(
                    'Ключ API з сайту mdblist.com для відображення рейтингів 7 платформ',
                    'Ключ API с сайта mdblist.com для отображения рейтингов 7 платформ'
                )
            },
            onChange: function() {
                clearPluginCache(true);
            }
        });

        if (window.Lampa && Lampa.Settings && Lampa.Settings.listener) {
            Lampa.Settings.listener.follow('open', function(ev) {
                if (ev && ev.name === PLUGIN_COMPONENT) {
                    window.setTimeout(function() {
                        updateAuthButtonText();
                        renderSettingsProfileStats();
                    }, 50);
                }
            });
        }

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_emoji_pack',
                type: 'select',
                values: getEmojiPackOptions(),
                default: 'apple'
            },
            field: {
                name: loc('Пак іконок емодзі', 'Пак иконок эмодзи'),
                description: loc(
                    'Візуальний стиль графіки для 5 емодзі-реакцій',
                    'Визуальный стиль графики для 5 эмодзи-реакций'
                )
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_pill_style',
                type: 'select',
                values: getPillStyleOptions(),
                default: 'glass'
            },
            field: {
                name: loc('Стиль капсул реакцій', 'Стиль капсул реакций'),
                description: loc(
                    'Зовнішній вигляд кнопок емодзі-реакцій на сторінці фільму',
                    'Внешний вид кнопок эмодзи-реакций на странице фильма'
                )
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_ratings_format',
                type: 'select',
                values: getRatingsFormatOptions(),
                default: 'full'
            },
            field: {
                name: loc('Формат відображення рейтингів', 'Формат отображения рейтингов'),
                description: loc(
                    'Щільність та формат чисел у блоці оцінок платформ',
                    'Плотность и формат чисел в блоке оценок платформ'
                )
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_ratings_style',
                type: 'select',
                values: getRatingsStyleOptions(),
                default: 'clean'
            },
            field: {
                name: loc('Стиль смужки рейтингів', 'Стиль полосы рейтингов'),
                description: loc(
                    'Оформлення карток оцінок IMDb, Trakt, TMDB та інших платформ',
                    'Оформление карточек оценок IMDb, Trakt, TMDB и других платформ'
                )
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_badge_style',
                type: 'select',
                values: {
                    original: loc('Оригінальні логотипи', 'Оригинальные логотипы'),
                    monochrome: loc('Монохромний', 'Монохромный'),
                    text_badges: loc('Текстові плашки', 'Текстовые плашки')
                },
                default: 'original'
            },
            field: {
                name: loc('Стиль іконок та бейджів рейтингів', 'Стиль иконок и бейджей рейтингов'),
                description: loc(
                    'Формат відображення логотипів рейтингів платформ',
                    'Формат отображения логотипов рейтингов платформ'
                )
            }
        });

        var scaleOpts = getScaleOptions();

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_scale_badges',
                type: 'select',
                values: scaleOpts,
                default: '1.0'
            },
            field: {
                name: loc('Масштаб бейджа «Переглянуто» та нагород', 'Масштаб бейджа «Просмотрено» и наград'),
                description: loc(
                    'Розмір верхнього рядка статусу перегляду та нагород (50%–180%)',
                    'Размер верхней строки статуса просмотра и наград (50%–180%)'
                )
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_scale_pills',
                type: 'select',
                values: scaleOpts,
                default: '1.0'
            },
            field: {
                name: loc('Масштаб емодзі-реакцій', 'Масштаб эмодзи-реакций'),
                description: loc(
                    'Розмір капсул реакцій під рейтингами (50%–180%)',
                    'Размер капсул реакций под рейтингами (50%–180%)'
                )
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_scale_ratings',
                type: 'select',
                values: scaleOpts,
                default: '1.0'
            },
            field: {
                name: loc('Масштаб смужки рейтингів', 'Масштаб полосы рейтингов'),
                description: loc(
                    'Розмір блоку оцінок 7 платформ (50%–180%)',
                    'Размер блока оценок 7 платформ (50%–180%)'
                )
            }
        });

        var toggles = new Array(
            { key: 'trakt_auto_scrobble', title: loc('Автоматичний скробблінг у плеєрі', 'Автоматический скробблинг в плеере') },
            { key: 'trakt_show_watched', title: loc('Показувати бейдж «Переглянуто»', 'Показывать бейдж «Просмотрено»') },
            { key: 'mdb_show_awards', title: loc('Показувати нагороди та номінації (MDBList)', 'Показывать награды и номинации (MDBList)') },
            { key: 'trakt_sync_watchlist', title: loc('Синхронізувати закладки з Trakt Watchlist', 'Синхронизировать закладки с Trakt Watchlist') },
            { key: 'mdb_show_bookmarks_row', title: loc('Показувати закладки на головній', 'Показывать закладки на главной'), bookmarksRefresh: true },
            { key: 'mdb_emoji_glow', title: loc('Кольорове світіння емодзі', 'Цветное свечение эмодзи') },
            { key: 'mdb_emoji_anim', title: loc('Анімація емодзі при наведенні', 'Анимация эмодзи при наведении') },
            { key: 'mdb_emoji_bar', title: loc('Смужка відсотків у капсулах', 'Полоса процентов в капсулах') },
            { key: 'mdb_show_pills', title: loc('Показувати реакції (5 емодзі)', 'Показывать реакции (5 эмодзи)') },
            { key: 'mdb_show_imdb', title: loc('Показувати IMDb', 'Показывать IMDb') },
            { key: 'mdb_show_trakt', title: loc('Показувати Trakt', 'Показывать Trakt') },
            { key: 'mdb_show_tmdb', title: loc('Показувати TMDB', 'Показывать TMDB') },
            { key: 'mdb_show_letterboxd', title: loc('Показувати Letterboxd', 'Показывать Letterboxd') },
            { key: 'mdb_show_tomatoes', title: loc('Показувати Rotten Tomatoes', 'Показывать Rotten Tomatoes') },
            { key: 'mdb_show_popcorn', title: loc('Показувати Popcornmeter', 'Показывать Popcornmeter') },
            { key: 'mdb_show_metacritic', title: loc('Показувати Metacritic', 'Показывать Metacritic') }
        );

        var i;
        for (i = 0; i < toggles.length; i++) {
            (function(tItem) {
                var paramDef = {
                    component: PLUGIN_COMPONENT,
                    param: {
                        name: tItem.key,
                        type: 'trigger',
                        default: true
                    },
                    field: {
                        name: tItem.title
                    }
                };
                if (tItem.bookmarksRefresh) {
                    paramDef.onChange = function() {
                        syncBookmarksRowRegistration();
                    };
                }
                Lampa.SettingsApi.addParam(paramDef);
            })(toggles[i]);
        }

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'trakt_sync_watchlist_btn',
                type: 'button'
            },
            field: {
                name: loc('Синхронізувати Watchlist зараз', 'Синхронизировать Watchlist сейчас'),
                description: loc(
                    'Двостороння синхронізація закладок Lampa та Trakt Watchlist',
                    'Двусторонняя синхронизация закладок Lampa и Trakt Watchlist'
                )
            },
            onChange: function() {
                if (!isTraktLoggedIn()) {
                    if (window.Lampa && Lampa.Noty) {
                        Lampa.Noty.show(loc('Спочатку увійдіть у Trakt', 'Сначала войдите в Trakt'));
                    }
                    return;
                }
                runTwoWayWatchlistSync(true);
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'trakt_import_history_btn',
                type: 'button'
            },
            field: {
                name: loc('Імпортувати стару історію Lampa в Trakt', 'Импортировать старую историю Lampa в Trakt'),
                description: loc(
                    'Одноразове перенесення локальної історії переглядів Lampa у ваш профіль Trakt',
                    'Разовый перенос локальной истории просмотров Lampa в ваш профиль Trakt'
                )
            },
            onChange: function() {
                importLampaHistoryToTrakt();
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_COMPONENT,
            param: {
                name: 'mdb_clear_cache_btn',
                type: 'button'
            },
            field: {
                name: loc('Очистити кеш рейтингів', 'Очистить кэш рейтингов'),
                description: loc(
                    'Видалити збережені рейтинги та реакції для повторного завантаження',
                    'Удалить сохранённые рейтинги и реакции для повторной загрузки'
                )
            },
            onChange: function() {
                clearPluginCache(false);
                renderSettingsProfileStats();
            }
        });
    }

    function registerManifest() {
        if (!window.Lampa || !Lampa.Manifest || !Lampa.Manifest.plugins) return;
        if (typeof Lampa.Manifest.plugins.push === 'function') {
            Lampa.Manifest.plugins.push({
                type: 'other',
                version: '1.9.3',
                name: 'Trakt & Рейтинги',
                description: loc(
                    'Синхронізація Trakt, нагороди, 5 емодзі-паків, 5 форматів рейтингів, 11 стилів, закладки на головній, скробблінг 80%, сезони серіалів та рейтинги з 7 платформ',
                    'Синхронизация Trakt, награды, 5 эмодзи-паков, 5 форматов рейтингов, 11 стилей, закладки на главной, скробблинг 80%, сезоны сериалов и рейтинги с 7 платформ'
                ),
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
            var mediaVoteKey = type + '_' + movie.id;
            var cacheKey = CACHE_PREFIX + mediaVoteKey;

            logDebug('Подія full:complite для:', movie.id, movie.title || movie.name || '');

            var cachedData = readCache(cacheKey);
            var keys = getApiKeys();

            var runMountAndFetch = function(rootEl) {
                if (rootEl) {
                    hideDefaultCardRates(rootEl);
                }

                if (cachedData) {
                    logDebug('Миттєвий рендер з кешу v13:', cacheKey);
                    var loggedInNow = isTraktLoggedIn();
                    var storedVote = (cachedData.userVote !== undefined) ? cachedData.userVote : getUserLocalVote(mediaVoteKey);
                    var cachedRenderState = {
                        ratings: cachedData.ratings,
                        reactions: cachedData.reactions,
                        mdbJson: cachedData.mdbJson || null,
                        apiError: cachedData.apiError || '',
                        ratingsLoading: false,
                        userTraktVote: loggedInNow ? storedVote : '',
                        bakedVote: storedVote || '',
                        watchedStatus: null
                    };
                    if (rootEl) renderIntoCard(rootEl, movie, cachedRenderState, 'all');

                    if (loggedInNow && keys.traktClientId) {
                        fetchUserTraktRatingForMedia(movie, cachedRenderState.mdbJson, function(userReactionKey) {
                            var clickAge = new Date().getTime() - getUserVoteTimestamp(mediaVoteKey);
                            if (clickAge >= 0 && clickAge < 60000) {
                                cachedRenderState.userTraktVote = getUserLocalVote(mediaVoteKey);
                            } else {
                                cachedRenderState.userTraktVote = userReactionKey;
                            }
                            var targetRoot = resolveRenderRoot(e) || rootEl;
                            if (targetRoot) renderIntoCard(targetRoot, movie, cachedRenderState, 'pills');
                        });

                        fetchUserWatchedStatusForMedia(movie, cachedRenderState.mdbJson, function(watchedStatus) {
                            cachedRenderState.watchedStatus = watchedStatus;
                            var targetRoot = resolveRenderRoot(e) || rootEl;
                            if (targetRoot) renderIntoCard(targetRoot, movie, cachedRenderState, 'status');
                        });
                    }
                    return;
                }

                var initialLocal = isTraktLoggedIn() ? '' : getUserLocalVote(mediaVoteKey);
                var state = {
                    ratings: new Array(),
                    reactions: keys.traktClientId
                        ? createEmptyReactions(loc('Завантаження оцінок Trakt...', 'Загрузка оценок Trakt...'), true)
                        : createEmptyReactions(loc('Вкажіть Trakt Client ID у Налаштуваннях', 'Укажите Trakt Client ID в Настройках'), false),
                    mdbJson: null,
                    apiError: keys.mdblistKey ? '' : 'NO_KEY',
                    ratingsLoading: Boolean(keys.mdblistKey),
                    userTraktVote: '',
                    bakedVote: initialLocal ? '' : '',
                    watchedStatus: null
                };

                var mdblistDone = !keys.mdblistKey;
                var traktDone = !keys.traktClientId;

                var syncSectionAndCache = function(sectionName) {
                    var currentRoot = resolveRenderRoot(e) || rootEl;
                    if (currentRoot) {
                        renderIntoCard(currentRoot, movie, state, sectionName);
                    }
                    if (mdblistDone && traktDone) {
                        var currentVote = isTraktLoggedIn() ? (state.userTraktVote || '') : getUserLocalVote(mediaVoteKey);
                        writeCache(cacheKey, {
                            ratings: state.ratings,
                            reactions: state.reactions,
                            mdbJson: state.mdbJson,
                            apiError: state.apiError,
                            userVote: currentVote
                        });
                    }
                };

                syncSectionAndCache('all');

                fetchMdblistViaChain(movie, keys.mdblistKey, function(errSummary, json) {
                    state.ratingsLoading = false;
                    mdblistDone = true;

                    if (errSummary === 'NO_KEY') {
                        state.apiError = 'NO_KEY';
                    } else if (errSummary || !json || !hasValidPositiveRatings(json.ratings)) {
                        state.apiError = errSummary || loc('Порожній масив ratings', 'Пустой массив ratings');
                        logDebug('MDBList API помилка:', state.apiError);
                    } else {
                        state.apiError = '';
                        state.ratings = json.ratings;
                        state.mdbJson = json;
                        logDebug('MDBList API успішно повернув рейтингів:', json.ratings.length);
                    }

                    syncSectionAndCache('ratings');
                    syncSectionAndCache('status');

                    if (keys.traktClientId) {
                        fetchTraktRatings(movie, json, keys.traktClientId, function(traktReactions) {
                            traktDone = true;
                            state.reactions = traktReactions;
                            if (isTraktLoggedIn()) {
                                state.bakedVote = state.userTraktVote || '';
                            }
                            syncSectionAndCache('pills');
                        });

                        if (isTraktLoggedIn()) {
                            fetchUserTraktRatingForMedia(movie, json, function(userReactionKey) {
                                state.userTraktVote = userReactionKey;
                                state.bakedVote = userReactionKey;
                                setUserLocalVote(mediaVoteKey, userReactionKey, false);
                                syncSectionAndCache('pills');
                            });

                            fetchUserWatchedStatusForMedia(movie, json, function(watchedStatus) {
                                state.watchedStatus = watchedStatus;
                                syncSectionAndCache('status');
                            });
                        }
                    }
                });
            };

            var immediateRoot = resolveRenderRoot(e);
            if (immediateRoot && immediateRoot.querySelector('.full-start__buttons, .full-start-new__buttons')) {
                runMountAndFetch(immediateRoot);
            } else {
                window.setTimeout(function() {
                    runMountAndFetch(resolveRenderRoot(e));
                }, 40);
            }
        });

        logDebug('Слухач подій full підключено');
    }

    function initPlugin() {
        if (initialized) return;
        initialized = true;

        logDebug('Ініціалізація плагіна Trakt & Рейтинги');
        cleanupLegacyStorageKeys();
        injectStyles();
        registerManifest();
        registerSettings();
        registerBookmarksFullComponent();
        attachFullListener();
        attachPlayerScrobbler();
        attachWatchlistListeners();
        attachBookmarksActivitySafeguard();
        registerBookmarksRow();
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
