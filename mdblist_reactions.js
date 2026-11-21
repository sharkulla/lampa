(function() {
    'use strict';

    var MDBLIST_API_KEY = 'utha0wvg7a0g4kwl10yee3t6x';
    var CACHE_PREFIX = 'mdblist_v8_';
    var OLD_CACHE_PREFIX = 'mdblist_v7_';
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
            if (raw._ts && raw.payload && raw.payload.ratings && raw.payload.ratings.length > 0) {
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
            if (!payload || !payload.ratings || payload.ratings.length === 0) return;
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

    function clearPluginCache() {
        var removed = 0;
        try {
            if (window.localStorage) {
                var keysToRemove = new Array();
                var i;
                for (i = 0; i < window.localStorage.length; i++) {
                    var k = window.localStorage.key(i);
                    if (k && (k.indexOf(CACHE_PREFIX) === 0 || k.indexOf(OLD_CACHE_PREFIX) === 0)) {
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
        if (window.Lampa && Lampa.Noty) {
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
            return Math.round(n / 1000) + 'K';
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

    function parseNumberFromText(str) {
        if (!str) return 0;
        var cleaned = String(str).replace(/[\s,\.\u00a0]/g, '');
        var val = parseInt(cleaned, 10);
        return isNaN(val) ? 0 : val;
    }

    function parseHistogramFromHtml(htmlText) {
        var bars = new Array(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        var foundCount = 0;

        if (!htmlText || typeof htmlText !== 'string') {
            return { bars: bars, total: 0 };
        }

        var attrRegex = /(?:Rating|Рейтинг|Оценка)\s*(10|[1-9])\s*[:\-]\s*([\d\s,\.\u00a0]+)/i;

        try {
            if (window.DOMParser) {
                var parser = new DOMParser();
                var doc = parser.parseFromString(htmlText, 'text/html');
                var nodes = doc.querySelectorAll('[title], [data-original-title], [data-bs-original-title], [aria-label], [data-tooltip]');
                var i;
                for (i = 0; i < nodes.length; i++) {
                    var el = nodes[i];
                    var txt = el.getAttribute('data-original-title') ||
                        el.getAttribute('data-bs-original-title') ||
                        el.getAttribute('title') ||
                        el.getAttribute('aria-label') ||
                        el.getAttribute('data-tooltip') || '';
                    if (!txt) continue;
                    var m = txt.match(attrRegex);
                    if (m) {
                        var ratingIdx = parseInt(m[1], 10);
                        var voteVal = parseNumberFromText(m[2]);
                        if (ratingIdx >= 1 && ratingIdx <= 10 && voteVal > bars[ratingIdx]) {
                            bars[ratingIdx] = voteVal;
                            foundCount++;
                        }
                    }
                }
            }
        } catch (err) {
            /* fallback to raw regex */
        }

        if (foundCount === 0) {
            var globalRegex = /(?:Rating|Рейтинг|Оценка)\s*(10|[1-9])\s*[:\-]\s*([\d\s,\.\u00a0]+)\s*(?:votes|vote|голос|голоси|голосів)?/gi;
            var match;
            while ((match = globalRegex.exec(htmlText)) !== null) {
                var idx = parseInt(match[1], 10);
                var v = parseNumberFromText(match[2]);
                if (idx >= 1 && idx <= 10 && v > bars[idx]) {
                    bars[idx] = v;
                }
            }
        }

        var total = 0;
        var k;
        for (k = 1; k <= 10; k++) {
            total += bars[k];
        }

        return { bars: bars, total: total };
    }

    function computeGaussianReactions(ratings, fallbackMean, fallbackVotes) {
        var sumWeighted = 0;
        var sumWeights = 0;
        var maxVotes = 0;
        var totalSourceVotes = 0;
        var i;

        for (i = 0; i < ratings.length; i++) {
            var r = ratings[i];
            if (!r || r.value === null || r.value === undefined) continue;
            var key = normalizeSourceKey(r.source);
            var val = Number(r.value);
            if (isNaN(val) || val <= 0) continue;

            var score10 = 0;
            if (key === 'imdb') {
                score10 = val;
            } else if (key === 'trakt' || key === 'tmdb' || key === 'popcorn') {
                score10 = val / 10;
            } else if (key === 'letterboxd') {
                score10 = val * 2;
            } else {
                continue;
            }

            var votes = Number(r.votes) || 100;
            if (votes > maxVotes) maxVotes = votes;
            totalSourceVotes += votes;
            var weight = Math.log(votes + 10);
            sumWeighted += score10 * weight;
            sumWeights += weight;
        }

        var mean = sumWeights > 0 ? (sumWeighted / sumWeights) : (Number(fallbackMean) || 7.0);
        if (mean < 1) mean = 1;
        if (mean > 10) mean = 10;

        var sigma = 1.65;
        var dist = new Array(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        var distSum = 0;
        var k;

        for (k = 1; k <= 10; k++) {
            var g = Math.exp(-Math.pow(k - mean, 2) / (2 * sigma * sigma));
            var tailFloor = 0.012;
            var combined = g + tailFloor;
            dist[k] = combined;
            distSum += combined;
        }

        var baseTotal = Number(fallbackVotes) || 0;
        if (maxVotes > 0) {
            baseTotal = Math.round(Math.min(3000, Math.max(200, Math.sqrt(totalSourceVotes) * 3.5)));
        } else if (baseTotal <= 0) {
            baseTotal = 150;
        } else if (baseTotal > 3000) {
            baseTotal = Math.round(Math.min(3000, Math.sqrt(baseTotal) * 3.5));
        }

        var bars = new Array(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        for (k = 1; k <= 10; k++) {
            bars[k] = Math.round((dist[k] / distSum) * baseTotal);
        }

        var masterpiece = bars[9] + bars[10];
        var worth = bars[7] + bars[8];
        var once = bars[5] + bars[6];
        var boring = bars[3] + bars[4];
        var weak = bars[1] + bars[2];

        if (baseTotal > 100) {
            if (weak < 1) weak = Math.max(1, Math.round(baseTotal * 0.012));
            if (boring < 1) boring = Math.max(1, Math.round(baseTotal * 0.02));
        }

        return {
            masterpiece: masterpiece,
            worth: worth,
            once: once,
            boring: boring,
            weak: weak,
            isEstimated: true
        };
    }

    function barsToReactions(bars) {
        return {
            masterpiece: (bars[9] || 0) + (bars[10] || 0),
            worth: (bars[7] || 0) + (bars[8] || 0),
            once: (bars[5] || 0) + (bars[6] || 0),
            boring: (bars[3] || 0) + (bars[4] || 0),
            weak: (bars[1] || 0) + (bars[2] || 0),
            isEstimated: false
        };
    }

    function buildFallbackData(movie) {
        var ratings = new Array();
        var voteAvg = Number(movie && movie.vote_average) || 0;
        var voteCount = Number(movie && movie.vote_count) || 0;

        if (voteAvg > 0) {
            ratings.push({
                source: 'tmdb',
                value: Math.round(voteAvg * 10),
                votes: voteCount
            });
        }

        return {
            ratings: ratings,
            reactions: computeGaussianReactions(ratings, voteAvg > 0 ? voteAvg : 7.0, voteCount),
            pageUrl: '',
            isFallback: true
        };
    }

    function resolvePageUrl(json, type) {
        if (json && json.url) {
            if (json.url.indexOf('http') === 0) return json.url;
            if (json.url.indexOf('/') === 0) return 'https://mdblist.com' + json.url;
            return 'https://mdblist.com/' + json.url;
        }
        if (json && json.ids && json.ids.slug) {
            var resolvedType = (json.type === 'show' || json.type === 'movie') ? json.type : type;
            return 'https://mdblist.com/' + resolvedType + '/' + json.ids.slug;
        }
        return '';
    }

    function fetchJsonDirectOrProxy(url) {
        return fetch(url).then(function(response) {
            logDebug('API прямий запит:', url, 'status=' + response.status);
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }
            return response.text();
        }).then(function(txt) {
            var parsed = JSON.parse(txt);
            if (!parsed || parsed.error) {
                throw new Error(parsed && parsed.error ? parsed.error : 'Empty JSON');
            }
            return parsed;
        }).catch(function(err) {
            logDebug('Прямий API запит не вдався, повтор через AllOrigins:', err && err.message ? err.message : err);
            var proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
            return fetch(proxyUrl).then(function(res) {
                logDebug('API запит через AllOrigins:', res.status);
                if (!res.ok) {
                    throw new Error('Proxy HTTP ' + res.status);
                }
                return res.text();
            }).then(function(txt) {
                var parsed = JSON.parse(txt);
                if (parsed && typeof parsed.contents === 'string' && !parsed.ratings) {
                    parsed = JSON.parse(parsed.contents);
                }
                return parsed;
            });
        });
    }

    function fetchHtmlViaProxyChain(pageUrl) {
        var allOriginsUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(pageUrl);
        var corsProxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(pageUrl);

        logDebug('Запит HTML гістограми через AllOrigins:', pageUrl);

        return fetch(allOriginsUrl).then(function(res) {
            logDebug('AllOrigins HTML status:', res.status);
            if (!res.ok) throw new Error('AllOrigins HTTP ' + res.status);
            return res.text();
        }).then(function(html) {
            var parsed = parseHistogramFromHtml(html);
            if (parsed.total > 0) {
                logDebug('AllOrigins успішно повернув голоси гістограми:', parsed.total);
                return parsed;
            }
            throw new Error('AllOrigins HTML без голосів гістограми');
        }).catch(function(err1) {
            logDebug('AllOrigins не дав гістограму (' + (err1 && err1.message ? err1.message : err1) + '), спроба через corsproxy.io');
            return fetch(corsProxyUrl).then(function(res2) {
                logDebug('corsproxy.io HTML status:', res2.status);
                if (!res2.ok) throw new Error('CorsProxy HTTP ' + res2.status);
                return res2.text();
            }).then(function(html2) {
                var parsed2 = parseHistogramFromHtml(html2);
                if (parsed2.total > 0) {
                    logDebug('corsproxy.io успішно повернув голоси гістограми:', parsed2.total);
                    return parsed2;
                }
                throw new Error('corsproxy.io HTML без голосів гістограми');
            }).catch(function(err2) {
                logDebug('corsproxy.io не дав гістограму (' + (err2 && err2.message ? err2.message : err2) + '), прямий fetch HTML');
                return fetch(pageUrl).then(function(res3) {
                    if (!res3.ok) throw new Error('Direct HTTP ' + res3.status);
                    return res3.text();
                }).then(function(html3) {
                    return parseHistogramFromHtml(html3);
                });
            });
        });
    }

    function fetchMdblistApiJson(movie) {
        var type = movie.first_air_date ? 'show' : 'movie';
        var tmdbUrl = 'https://api.mdblist.com/tmdb/' + type + '/' + movie.id + '?apikey=' + MDBLIST_API_KEY;
        var imdbId = movie.imdb_id || (movie.external_ids && movie.external_ids.imdb_id) || '';

        return fetchJsonDirectOrProxy(tmdbUrl).catch(function() {
            return null;
        }).then(function(json) {
            var hasRatings = json && json.ratings && json.ratings.length > 0;
            if (!hasRatings && imdbId) {
                var imdbUrl = 'https://api.mdblist.com/imdb/' + imdbId + '?apikey=' + MDBLIST_API_KEY;
                logDebug('Повторний запит MDBList за IMDb ID:', imdbId);
                return fetchJsonDirectOrProxy(imdbUrl).catch(function() {
                    return json;
                });
            }
            return json;
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
            '  align-items: flex-start !important;' +
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
                var i;

                for (i = 0; i < sortedPills.length; i++) {
                    (function(item) {
                        var pill = document.createElement('div');
                        pill.className = 'mdb-pill selector' + (item.isSelected ? ' active' : '');
                        pill.setAttribute('data-reaction-key', item.key);

                        var tooltip = document.createElement('span');
                        tooltip.className = 'mdb-pill-tooltip';
                        tooltip.textContent = item.label;

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

            var ratingsRow = document.createElement('div');
            ratingsRow.className = 'mdb-ratings-row';
            var renderedRatings = 0;

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
            logDebug('Порожній блок wrapper (усі секції вимкнені або без даних)');
            return false;
        }

        var reactionsTarget = rootEl.querySelector('.full-start__reactions, .full-start-new__reactions');
        if (reactionsTarget && reactionsTarget.parentNode) {
            logDebug('DOM контейнер знайдено (reactionsTarget):', reactionsTarget.className);
            reactionsTarget.parentNode.insertBefore(wrapper, reactionsTarget);
            return true;
        }

        var buttonsTarget = rootEl.querySelector('.full-start__buttons, .full-start-new__buttons');
        if (buttonsTarget && buttonsTarget.parentNode) {
            logDebug('DOM контейнер знайдено (buttonsTarget):', buttonsTarget.className);
            buttonsTarget.parentNode.insertBefore(wrapper, buttonsTarget);
            return true;
        }

        var bodyTarget = rootEl.querySelector('.full-start__body, .full-start-new__body, .full-start-new__left, .full-start');
        if (bodyTarget) {
            logDebug('DOM контейнер знайдено (bodyTarget):', bodyTarget.className);
            bodyTarget.appendChild(wrapper);
            return true;
        }

        logDebug('Не знайдено стандартних контейнерів, додано у rootEl');
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
                clearPluginCache();
            }
        });
    }

    function registerManifest() {
        if (!window.Lampa || !Lampa.Manifest || !Lampa.Manifest.plugins) return;
        if (typeof Lampa.Manifest.plugins.push === 'function') {
            Lampa.Manifest.plugins.push({
                type: 'other',
                version: '1.0.2',
                name: 'MDBList Реакції та Рейтинги',
                description: 'Інтерактивні реакції за оцінками 1–10 з MDBList та панель рейтингів з 8 платформ',
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

            var fallbackData = buildFallbackData(movie);
            var cachedData = readCache(cacheKey);

            window.setTimeout(function() {
                var rootEl = resolveRenderRoot(e);
                logDebug('Перевірка DOM через 150мс, rootEl знайдено:', Boolean(rootEl));

                if (cachedData) {
                    logDebug('Миттєвий рендер з кешу v8:', cacheKey);
                    if (rootEl) renderIntoCard(rootEl, movie, cachedData);
                    return;
                }

                if (rootEl) {
                    logDebug('Первинний рендер TMDB fallback до завантаження MDBList');
                    renderIntoCard(rootEl, movie, fallbackData);
                }

                fetchMdblistApiJson(movie).then(function(json) {
                    if (!json || !json.ratings || json.ratings.length === 0) {
                        logDebug('MDBList API не повернув рейтингів для ID:', movie.id);
                        return;
                    }

                    logDebug('MDBList API повернув рейтингів:', json.ratings.length);
                    var pageUrl = resolvePageUrl(json, type);
                    var apiImmediatePayload = {
                        ratings: json.ratings,
                        reactions: computeGaussianReactions(json.ratings, movie.vote_average, movie.vote_count),
                        pageUrl: pageUrl,
                        isFallback: false
                    };

                    var freshRoot = resolveRenderRoot(e) || rootEl;
                    if (freshRoot) {
                        logDebug('Негайний рендер усіх рейтингів MDBList + розрахункових пігулок');
                        renderIntoCard(freshRoot, movie, apiImmediatePayload);
                    }

                    if (!pageUrl) {
                        writeCache(cacheKey, apiImmediatePayload);
                        return;
                    }

                    fetchHtmlViaProxyChain(pageUrl).then(function(parsed) {
                        if (parsed && parsed.total > 0) {
                            var exactPayload = {
                                ratings: json.ratings,
                                reactions: barsToReactions(parsed.bars),
                                pageUrl: pageUrl,
                                isFallback: false
                            };
                            writeCache(cacheKey, exactPayload);
                            var targetRoot = resolveRenderRoot(e) || freshRoot;
                            if (targetRoot) {
                                logDebug('Оновлення картки точними голосами гістограми MDBList (' + parsed.total + ' голосів)');
                                renderIntoCard(targetRoot, movie, exactPayload);
                            }
                        } else {
                            logDebug('На сторінці MDBList 0 голосів учасників, збережено мультиплатформний розрахунок');
                            writeCache(cacheKey, apiImmediatePayload);
                        }
                    }).catch(function(errHtml) {
                        logDebug('Не вдалося отримати HTML гістограму через проксі:', errHtml && errHtml.message ? errHtml.message : errHtml);
                        writeCache(cacheKey, apiImmediatePayload);
                    });
                }).catch(function(errApi) {
                    logDebug('Помилка запиту до MDBList API:', errApi && errApi.message ? errApi.message : errApi);
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
