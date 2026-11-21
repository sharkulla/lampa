(function() {
    'use strict';

    if (window.mdblist_reactions_plugin_loaded) return;
    window.mdblist_reactions_plugin_loaded = true;

    var MDBLIST_API_KEY = 'utha0wvg7a0g4kwl10yee3t6x';
    var CACHE_MINUTES = 1440;
    var GAUSSIAN_SIGMA = 1.65;
    var STYLE_ID = 'mdblist-reactions-styles-v1';
    var svgUid = 0;

    var REACTION_DEFS = new Array(
        { key: 'fire', emoji: '\uD83D\uDD25', tooltip: 'Шедевр' },
        { key: 'like', emoji: '\uD83D\uDC4D', tooltip: 'Варто глянути' },
        { key: 'meh', emoji: '\uD83E\uDD14', tooltip: 'На один раз' },
        { key: 'sleep', emoji: '\uD83D\uDE34', tooltip: 'Нудно' },
        { key: 'poop', emoji: '\uD83D\uDCA9', tooltip: 'Слабко' }
    );

    var PLATFORM_ORDER = new Array('imdb', 'trakt', 'tmdb', 'tomatoes', 'popcorn', 'metacritic');

    function registerManifest() {
        if (!window.Lampa || !Lampa.Manifest) return;
        if (typeof Lampa.Manifest.plugins !== 'object' || Lampa.Manifest.plugins === null) {
            Lampa.Manifest.plugins = new Array();
        }
        var meta = {
            type: 'other',
            version: '1.0.0',
            name: 'MDBList Реакції та Рейтинги',
            description: 'Реакції глядачів та детальні рейтинги з кількістю голосів',
            component: 'mdblist_reactions'
        };
        if (typeof Lampa.Manifest.plugins.push === 'function') {
            var exists = false;
            for (var i = 0; i < Lampa.Manifest.plugins.length; i++) {
                if (Lampa.Manifest.plugins[i] && Lampa.Manifest.plugins[i].component === 'mdblist_reactions') {
                    exists = true;
                    break;
                }
            }
            if (!exists) Lampa.Manifest.plugins.push(meta);
        } else {
            Lampa.Manifest.plugins.mdblist_reactions = meta;
        }
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        var css = '' +
            '.mdblist-rc-hidden-orig { display: none !important; }' +
            '.mdblist-rc-root {' +
            '    display: block;' +
            '    width: 100%;' +
            '    margin: 0.9em 0 1.2em 0;' +
            '    overflow: visible;' +
            '    position: relative;' +
            '    z-index: 3;' +
            '}' +
            '.mdblist-rc-pills {' +
            '    display: flex;' +
            '    flex-wrap: wrap;' +
            '    align-items: center;' +
            '    gap: 0.65em;' +
            '    margin-bottom: 1.15em;' +
            '    overflow: visible;' +
            '}' +
            '.mdblist-rc-pill {' +
            '    position: relative;' +
            '    display: inline-flex;' +
            '    align-items: center;' +
            '    gap: 0.5em;' +
            '    background: rgba(32, 34, 38, 0.78);' +
            '    backdrop-filter: blur(10px);' +
            '    -webkit-backdrop-filter: blur(10px);' +
            '    border-radius: 999px;' +
            '    padding: 0.4em 0.9em;' +
            '    border: 1.5px solid rgba(255, 255, 255, 0.08);' +
            '    cursor: pointer;' +
            '    user-select: none;' +
            '    -webkit-user-select: none;' +
            '    transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;' +
            '    outline: none;' +
            '}' +
            '.mdblist-rc-pill:hover,' +
            '.mdblist-rc-pill.focus {' +
            '    background: rgba(50, 54, 62, 0.92);' +
            '    border-color: rgba(255, 255, 255, 0.55);' +
            '    transform: translateY(-1px);' +
            '}' +
            '.mdblist-rc-pill.is-active {' +
            '    border-color: #ffffff;' +
            '    background: rgba(54, 58, 68, 0.94);' +
            '    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35), 0 4px 12px rgba(0, 0, 0, 0.35);' +
            '}' +
            '.mdblist-rc-emoji {' +
            '    font-size: 1.3em;' +
            '    line-height: 1;' +
            '    display: inline-flex;' +
            '    align-items: center;' +
            '    justify-content: center;' +
            '}' +
            '.mdblist-rc-count {' +
            '    font-size: 1.02em;' +
            '    font-weight: 700;' +
            '    color: #ffffff;' +
            '    line-height: 1;' +
            '    letter-spacing: 0.01em;' +
            '}' +
            '.mdblist-rc-tooltip {' +
            '    position: absolute;' +
            '    left: 50%;' +
            '    bottom: calc(100% + 0.55em);' +
            '    transform: translateX(-50%) translateY(4px);' +
            '    background: rgba(24, 26, 30, 0.95);' +
            '    color: #ffffff;' +
            '    font-size: 0.8em;' +
            '    font-weight: 600;' +
            '    line-height: 1.2;' +
            '    padding: 0.38em 0.72em;' +
            '    border-radius: 0.5em;' +
            '    border: 1px solid rgba(255, 255, 255, 0.16);' +
            '    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);' +
            '    white-space: nowrap;' +
            '    pointer-events: none;' +
            '    opacity: 0;' +
            '    visibility: hidden;' +
            '    transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s ease;' +
            '    z-index: 25;' +
            '}' +
            '.mdblist-rc-tooltip:after {' +
            '    content: "";' +
            '    position: absolute;' +
            '    top: 100%;' +
            '    left: 50%;' +
            '    margin-left: -4px;' +
            '    border-width: 4px;' +
            '    border-style: solid;' +
            '    border-color: rgba(24, 26, 30, 0.95) transparent transparent transparent;' +
            '}' +
            '.mdblist-rc-pill:hover .mdblist-rc-tooltip,' +
            '.mdblist-rc-pill.focus .mdblist-rc-tooltip {' +
            '    opacity: 1;' +
            '    visibility: visible;' +
            '    transform: translateX(-50%) translateY(0);' +
            '}' +
            '.mdblist-rc-ratings {' +
            '    display: flex;' +
            '    flex-wrap: wrap;' +
            '    align-items: flex-start;' +
            '    gap: 1.1em 2.1em;' +
            '}' +
            '.mdblist-rc-rating-item {' +
            '    display: flex;' +
            '    flex-direction: column;' +
            '    align-items: flex-start;' +
            '}' +
            '.mdblist-rc-rating-top {' +
            '    display: flex;' +
            '    align-items: center;' +
            '    gap: 0.55em;' +
            '}' +
            '.mdblist-rc-icon {' +
            '    width: 1.95em;' +
            '    height: 1.95em;' +
            '    display: inline-flex;' +
            '    align-items: center;' +
            '    justify-content: center;' +
            '    flex-shrink: 0;' +
            '}' +
            '.mdblist-rc-icon svg {' +
            '    width: 100%;' +
            '    height: 100%;' +
            '    display: block;' +
            '}' +
            '.mdblist-rc-score-wrap {' +
            '    display: inline-flex;' +
            '    align-items: baseline;' +
            '    line-height: 1;' +
            '}' +
            '.mdblist-rc-score {' +
            '    font-size: 1.55em;' +
            '    font-weight: 800;' +
            '    color: #ffffff;' +
            '    letter-spacing: -0.02em;' +
            '}' +
            '.mdblist-rc-denom {' +
            '    font-size: 0.88em;' +
            '    font-weight: 500;' +
            '    color: rgba(255, 255, 255, 0.52);' +
            '    margin-left: 0.14em;' +
            '}' +
            '.mdblist-rc-votes {' +
            '    font-size: 0.84em;' +
            '    font-weight: 400;' +
            '    color: rgba(255, 255, 255, 0.52);' +
            '    margin-top: 0.34em;' +
            '    white-space: nowrap;' +
            '}' +
            '@media screen and (max-width: 767px) {' +
            '    .mdblist-rc-pills { gap: 0.45em; }' +
            '    .mdblist-rc-pill { padding: 0.35em 0.72em; }' +
            '    .mdblist-rc-ratings { gap: 0.9em 1.35em; }' +
            '    .mdblist-rc-score { font-size: 1.35em; }' +
            '}';

        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.type = 'text/css';
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
    }

    function formatCompact(num) {
        var n = Math.max(0, Math.round(Number(num) || 0));
        if (n >= 1000000) {
            return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        }
        if (n >= 1000) {
            return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        }
        return String(n);
    }

    function formatVotesLabel(num) {
        var n = Math.max(0, Math.round(Number(num) || 0));
        if (n >= 1000) {
            return formatCompact(n) + ' голосів';
        }
        var mod10 = n % 10;
        var mod100 = n % 100;
        if (mod10 === 1 && mod100 !== 11) {
            return n + ' голос';
        }
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
            return n + ' голоси';
        }
        return n + ' голосів';
    }

    function buildPlatformIcon(source, numericValue) {
        svgUid += 1;
        var uid = svgUid;

        if (source === 'imdb') {
            return '' +
                '<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">' +
                '    <rect x="1" y="1" width="34" height="34" rx="6" fill="#F5C518"/>' +
                '    <text x="18" y="23.5" text-anchor="middle" fill="#000000" font-family="Impact, \'Arial Narrow\', Arial, sans-serif" font-weight="900" font-size="14" letter-spacing="-0.4">IMDb</text>' +
                '</svg>';
        }

        if (source === 'trakt') {
            var gradId = 'mdblist-trakt-' + uid;
            return '' +
                '<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">' +
                '    <defs>' +
                '        <linearGradient id="' + gradId + '" x1="0%" y1="0%" x2="100%" y2="100%">' +
                '            <stop offset="0%" stop-color="#9B30B6"/>' +
                '            <stop offset="55%" stop-color="#E61E3C"/>' +
                '            <stop offset="100%" stop-color="#FF2E2E"/>' +
                '        </linearGradient>' +
                '    </defs>' +
                '    <rect x="1" y="1" width="34" height="34" rx="8" fill="url(#' + gradId + ')"/>' +
                '    <rect x="6.5" y="6.5" width="23" height="23" rx="5.5" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.6"/>' +
                '    <path d="M11.5 19.5 L16.2 24.2 L26 12.2" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
                '    <path d="M11.5 14.8 L16.2 19.5 L23.5 10.6" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
                '</svg>';
        }

        if (source === 'tmdb') {
            var tmdbGrad = 'mdblist-tmdb-' + uid;
            return '' +
                '<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">' +
                '    <defs>' +
                '        <linearGradient id="' + tmdbGrad + '" x1="0%" y1="0%" x2="100%" y2="0%">' +
                '            <stop offset="0%" stop-color="#90CEA1"/>' +
                '            <stop offset="100%" stop-color="#01B4E4"/>' +
                '        </linearGradient>' +
                '    </defs>' +
                '    <text x="2" y="11" fill="url(#' + tmdbGrad + ')" font-family="Arial, sans-serif" font-weight="900" font-size="8.2">THE</text>' +
                '    <rect x="20.5" y="5.2" width="13.5" height="6" rx="3" fill="#01B4E4"/>' +
                '    <text x="2" y="21" fill="url(#' + tmdbGrad + ')" font-family="Arial, sans-serif" font-weight="900" font-size="9.2" letter-spacing="-0.2">MOVIE</text>' +
                '    <text x="2" y="31" fill="url(#' + tmdbGrad + ')" font-family="Arial, sans-serif" font-weight="900" font-size="9.5">DB</text>' +
                '    <rect x="17.5" y="24.5" width="16.5" height="6.2" rx="3.1" fill="url(#' + tmdbGrad + ')"/>' +
                '</svg>';
        }

        if (source === 'tomatoes') {
            if (numericValue >= 60) {
                return '' +
                    '<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">' +
                    '    <circle cx="18" cy="18" r="16" fill="#189B38"/>' +
                    '    <circle cx="18" cy="19.2" r="11.8" fill="#FA320A"/>' +
                    '    <ellipse cx="14" cy="15" rx="3" ry="1.8" transform="rotate(-25 14 15)" fill="rgba(255,255,255,0.35)"/>' +
                    '    <path d="M18 7.5 C16.2 4.5, 13.5 5.2, 13 7.5 C15 7.8, 16.5 8.5, 18 9.2 C19.5 8.5, 21 7.8, 23 7.5 C22.5 5.2, 19.8 4.5, 18 7.5 Z" fill="#23B54B"/>' +
                    '    <path d="M18 6 L18 10.5 M14.5 8 L18 10.5 L21.5 8" stroke="#137A2D" stroke-width="1.3" stroke-linecap="round"/>' +
                    '    <rect x="6.5" y="15.2" width="23" height="7" rx="2" fill="#FFF3B0"/>' +
                    '    <text x="18" y="20.6" text-anchor="middle" fill="#D92200" font-family="Arial, sans-serif" font-weight="900" font-size="5.6" letter-spacing="0.2">FRESH</text>' +
                    '</svg>';
            }
            return '' +
                '<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">' +
                '    <path d="M18 4 C21 7, 26 5, 28 9 C32 10, 31 15, 34 18 C30 21, 32 26, 27 28 C25 32, 20 30, 17 33 C14 29, 9 32, 7 27 C3 24, 5 19, 2 16 C6 13, 4 8, 9 7 C11 3, 15 6, 18 4 Z" fill="#63B82B"/>' +
                '    <circle cx="15" cy="15" r="2.2" fill="#9EE05A"/>' +
                '    <circle cx="22" cy="21" r="1.5" fill="#9EE05A"/>' +
                '</svg>';
        }

        if (source === 'popcorn') {
            return '' +
                '<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">' +
                '    <circle cx="12" cy="10.5" r="4.2" fill="#FFD633"/>' +
                '    <circle cx="18" cy="8.5" r="4.6" fill="#FFE45E"/>' +
                '    <circle cx="24" cy="10.5" r="4.2" fill="#FFC414"/>' +
                '    <circle cx="14.5" cy="12.5" r="3.6" fill="#FFF08A"/>' +
                '    <circle cx="21.5" cy="12.5" r="3.6" fill="#FFD633"/>' +
                '    <polygon points="8,13.5 28,13.5 25,33 11,33" fill="#FFFFFF"/>' +
                '    <polygon points="8,13.5 12.2,13.5 14,33 11,33" fill="#E62424"/>' +
                '    <polygon points="16,13.5 20,13.5 19.6,33 16.4,33" fill="#E62424"/>' +
                '    <polygon points="23.8,13.5 28,13.5 25,33 22,33" fill="#E62424"/>' +
                '    <rect x="7" y="12.5" width="22" height="2.4" rx="1" fill="#D11919"/>' +
                '</svg>';
        }

        return '' +
            '<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">' +
            '    <circle cx="18" cy="18" r="16" fill="#FFCC34"/>' +
            '    <text x="18" y="24" text-anchor="middle" fill="#000000" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="20" transform="rotate(-14 18 18)">m</text>' +
            '</svg>';
    }

    function normalizeRatings(apiData, movie) {
        var map = {};
        var list = (apiData && apiData.ratings && typeof apiData.ratings.length === 'number') ? apiData.ratings : new Array();

        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            if (!item || !item.source) continue;
            var src = String(item.source).toLowerCase();
            if (PLATFORM_ORDER.indexOf(src) === -1) continue;

            var val = item.value;
            var score = item.score;
            if ((val === null || typeof val === 'undefined') && (score === null || typeof score === 'undefined')) continue;

            var numVal = Number(val);
            if (isNaN(numVal) || numVal <= 0) {
                numVal = Number(score);
            }
            if (isNaN(numVal) || numVal <= 0) continue;

            var votes = Number(item.votes) || 0;

            if (src === 'imdb') {
                if (numVal > 10) numVal = numVal / 10;
                map[src] = {
                    source: src,
                    displayScore: numVal.toFixed(1),
                    denom: '/10',
                    numeric100: numVal * 10,
                    rating10: numVal,
                    votes: votes
                };
            } else if (src === 'trakt' || src === 'tomatoes' || src === 'popcorn') {
                if (numVal <= 10 && score && Number(score) > 10) numVal = Number(score);
                var pct = Math.round(numVal);
                map[src] = {
                    source: src,
                    displayScore: String(pct),
                    denom: '%',
                    numeric100: pct,
                    rating10: pct / 10,
                    votes: votes
                };
            } else if (src === 'tmdb' || src === 'metacritic') {
                if (src === 'tmdb' && numVal <= 10) {
                    numVal = (score && Number(score) > 10) ? Number(score) : Math.round(numVal * 10);
                }
                var out100 = Math.round(numVal);
                map[src] = {
                    source: src,
                    displayScore: String(out100),
                    denom: '/100',
                    numeric100: out100,
                    rating10: out100 / 10,
                    votes: votes
                };
            }
        }

        if (!map.tmdb && movie && Number(movie.vote_average) > 0) {
            var tmdbAvg = Number(movie.vote_average);
            var tmdb100 = Math.round(tmdbAvg * 10);
            map.tmdb = {
                source: 'tmdb',
                displayScore: String(tmdb100),
                denom: '/100',
                numeric100: tmdb100,
                rating10: tmdbAvg,
                votes: Number(movie.vote_count) || 0
            };
        }

        return map;
    }

    function computeGaussianReactions(ratingsMap, movie) {
        var userSources = new Array('imdb', 'trakt', 'tmdb', 'popcorn');
        var weightedSum = 0;
        var weightTotal = 0;
        var totalVotes = 0;
        var hasWeightedVotes = false;
        var fallbackRatingSum = 0;
        var fallbackRatingCount = 0;

        for (var i = 0; i < userSources.length; i++) {
            var entry = ratingsMap[userSources[i]];
            if (!entry || !(entry.rating10 > 0)) continue;
            fallbackRatingSum += entry.rating10;
            fallbackRatingCount += 1;
            if (entry.votes > 0) {
                hasWeightedVotes = true;
                weightedSum += entry.rating10 * entry.votes;
                weightTotal += entry.votes;
                totalVotes += entry.votes;
            }
        }

        var mu = 0;
        if (hasWeightedVotes && weightTotal > 0) {
            mu = weightedSum / weightTotal;
        } else if (fallbackRatingCount > 0) {
            mu = fallbackRatingSum / fallbackRatingCount;
            totalVotes = Number(movie && movie.vote_count) || 0;
        } else {
            mu = Number(movie && movie.vote_average) || 0;
            totalVotes = Number(movie && movie.vote_count) || 0;
        }

        if (mu < 1) mu = 1;
        if (mu > 10) mu = 10;

        var counts = {
            fire: 0,
            like: 0,
            meh: 0,
            sleep: 0,
            poop: 0
        };

        if (totalVotes <= 0) {
            return counts;
        }

        var scoreWeights = new Array();
        var weightSum10 = 0;
        for (var s = 1; s <= 10; s++) {
            var z = (s - mu) / GAUSSIAN_SIGMA;
            var w = Math.exp(-0.5 * z * z);
            scoreWeights.push(w);
            weightSum10 += w;
        }

        var bucketsRaw = {
            poop: (scoreWeights[0] + scoreWeights[1]) / weightSum10 * totalVotes,
            sleep: (scoreWeights[2] + scoreWeights[3]) / weightSum10 * totalVotes,
            meh: (scoreWeights[4] + scoreWeights[5]) / weightSum10 * totalVotes,
            like: (scoreWeights[6] + scoreWeights[7]) / weightSum10 * totalVotes,
            fire: (scoreWeights[8] + scoreWeights[9]) / weightSum10 * totalVotes
        };

        var keys = new Array('fire', 'like', 'meh', 'sleep', 'poop');
        var roundedSum = 0;
        var maxKey = 'like';
        var maxVal = -1;

        for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            var rounded = Math.round(bucketsRaw[key]);
            counts[key] = rounded;
            roundedSum += rounded;
            if (bucketsRaw[key] > maxVal) {
                maxVal = bucketsRaw[key];
                maxKey = key;
            }
        }

        var diff = Math.round(totalVotes) - roundedSum;
        if (diff !== 0 && counts[maxKey] + diff >= 0) {
            counts[maxKey] += diff;
        }

        return counts;
    }

    function getUserVote(movieId) {
        if (!window.Lampa || !Lampa.Storage) return '';
        return Lampa.Storage.get('mdblist_user_vote_' + movieId, '');
    }

    function setUserVote(movieId, reactionKey) {
        if (!window.Lampa || !Lampa.Storage) return;
        Lampa.Storage.set('mdblist_user_vote_' + movieId, reactionKey || '');
    }

    function readCachedMdblist(cacheKey) {
        if (!window.Lampa || !Lampa.Storage) return null;
        var now = Date.now();
        var maxMs = CACHE_MINUTES * 60 * 1000;
        var cached = null;

        if (typeof Lampa.Storage.cache === 'function') {
            cached = Lampa.Storage.cache(cacheKey, CACHE_MINUTES, {});
            if (cached && cached._ts && (now - cached._ts < maxMs) && cached.ratings) {
                return cached;
            }
        }

        var raw = Lampa.Storage.get(cacheKey, null);
        if (raw && raw.value && raw.value._ts && (now - raw.value._ts < maxMs) && raw.value.ratings) {
            return raw.value;
        }
        return null;
    }

    function writeCachedMdblist(cacheKey, data) {
        if (!window.Lampa || !Lampa.Storage || !data) return;
        data._ts = Date.now();
        Lampa.Storage.set(cacheKey, {
            time: data._ts,
            value: data
        });
    }

    function fetchMdblistData(movie, callback) {
        if (!movie || !movie.id) {
            callback(null);
            return;
        }

        var mediaType = movie.first_air_date ? 'show' : 'movie';
        var cacheKey = 'mdblist_data_v1_' + mediaType + '_' + movie.id;
        var cached = readCachedMdblist(cacheKey);
        if (cached) {
            callback(cached);
            return;
        }

        var url = 'https://api.mdblist.com/tmdb/' + mediaType + '/' + encodeURIComponent(String(movie.id)) + '?apikey=' + encodeURIComponent(MDBLIST_API_KEY);
        var net = new Lampa.Reguest();
        net.silent(
            url,
            function(response) {
                var parsed = response;
                if (typeof parsed === 'string') {
                    try {
                        parsed = JSON.parse(parsed);
                    } catch (err) {
                        parsed = null;
                    }
                }
                if (parsed && typeof parsed === 'object' && parsed.ratings) {
                    writeCachedMdblist(cacheKey, parsed);
                    callback(parsed);
                } else {
                    callback(null);
                }
            },
            function() {
                callback(null);
            }
        );
    }

    function buildReactionsDOM(movieId, baseCounts) {
        var userVote = getUserVote(movieId);
        var $pills = $('<div class="mdblist-rc-pills"></div>');
        var lastTrigger = 0;

        for (var i = 0; i < REACTION_DEFS.length; i++) {
            (function(def) {
                var count = (baseCounts[def.key] || 0) + (userVote === def.key ? 1 : 0);
                var $pill = $(
                    '<div class="mdblist-rc-pill selector" data-reaction="' + def.key + '" title="' + def.tooltip + '">' +
                    '    <span class="mdblist-rc-tooltip">' + def.tooltip + '</span>' +
                    '    <span class="mdblist-rc-emoji">' + def.emoji + '</span>' +
                    '    <span class="mdblist-rc-count">' + formatCompact(count) + '</span>' +
                    '</div>'
                );

                if (userVote === def.key) {
                    $pill.addClass('is-active');
                }

                function handleToggle(ev) {
                    if (ev && ev.stopPropagation) ev.stopPropagation();
                    var now = Date.now();
                    if (now - lastTrigger < 280) return;
                    lastTrigger = now;

                    var currentVote = getUserVote(movieId);
                    var nextVote = (currentVote === def.key) ? '' : def.key;
                    setUserVote(movieId, nextVote);

                    var currentCounts = $pills.data('baseCounts') || baseCounts;
                    $pills.find('.mdblist-rc-pill').each(function() {
                        var $el = $(this);
                        var k = $el.attr('data-reaction');
                        var isSelected = (nextVote === k);
                        var updatedVal = (currentCounts[k] || 0) + (isSelected ? 1 : 0);
                        $el.toggleClass('is-active', isSelected);
                        $el.find('.mdblist-rc-count').text(formatCompact(updatedVal));
                    });
                }

                $pill.on('hover:enter click', handleToggle);
                $pills.append($pill);
            })(REACTION_DEFS[i]);
        }

        $pills.data('baseCounts', baseCounts);
        return $pills;
    }

    function updateReactionsDOM($pills, movieId, baseCounts) {
        var userVote = getUserVote(movieId);
        $pills.data('baseCounts', baseCounts);
        $pills.find('.mdblist-rc-pill').each(function() {
            var $el = $(this);
            var k = $el.attr('data-reaction');
            var isSelected = (userVote === k);
            var val = (baseCounts[k] || 0) + (isSelected ? 1 : 0);
            $el.toggleClass('is-active', isSelected);
            $el.find('.mdblist-rc-count').text(formatCompact(val));
        });
    }

    function renderRatingsDOM($ratings, ratingsMap) {
        $ratings.empty();
        for (var i = 0; i < PLATFORM_ORDER.length; i++) {
            var src = PLATFORM_ORDER[i];
            var item = ratingsMap[src];
            if (!item) continue;

            var iconHtml = buildPlatformIcon(src, item.numeric100);
            var $item = $(
                '<div class="mdblist-rc-rating-item" data-source="' + src + '">' +
                '    <div class="mdblist-rc-rating-top">' +
                '        <div class="mdblist-rc-icon">' + iconHtml + '</div>' +
                '        <div class="mdblist-rc-score-wrap">' +
                '            <span class="mdblist-rc-score">' + item.displayScore + '</span>' +
                '            <span class="mdblist-rc-denom">' + item.denom + '</span>' +
                '        </div>' +
                '    </div>' +
                '    <div class="mdblist-rc-votes">' + formatVotesLabel(item.votes) + '</div>' +
                '</div>'
            );
            $ratings.append($item);
        }
    }

    function syncSpatialCollection(render, activity) {
        if (!window.Lampa || !Lampa.Controller || !Lampa.Activity) return;
        try {
            var active = Lampa.Activity.active();
            if (!active || active.activity !== activity) return;
            var enabled = Lampa.Controller.enabled();
            if (enabled && enabled.name === 'full_start') {
                var focused = render.find('.focus').get(0);
                Lampa.Controller.collectionSet(render);
                if (focused) {
                    Lampa.Controller.collectionFocus(focused, render);
                }
            }
        } catch (err) {
            // Safe ignore if controller not active yet
        }
    }

    function onFullEvent(e) {
        if (!e || e.type !== 'complite') return;
        if (!e.data || !e.data.movie || !e.object || !e.object.activity) return;

        var movie = e.data.movie;
        var activity = e.object.activity;
        var render = activity.render();
        if (!render || !render.length) return;

        render.find('.mdblist-rc-root').remove();

        var $origReactions = render.find('.full-start-new__reactions, .full-start__reactions');
        var $root = $('<div class="mdblist-rc-root"></div>');

        if ($origReactions.length) {
            $origReactions.addClass('mdblist-rc-hidden-orig');
            $origReactions.first().after($root);
        } else {
            var $buttons = render.find('.full-start-new__buttons, .full-start__buttons');
            if ($buttons.length) {
                $buttons.first().before($root);
            } else {
                var $body = render.find('.full-start-new__body, .full-start__body');
                if ($body.length) {
                    $body.first().append($root);
                } else {
                    render.append($root);
                }
            }
        }

        var initialRatingsMap = normalizeRatings(null, movie);
        var initialCounts = computeGaussianReactions(initialRatingsMap, movie);

        var $pills = buildReactionsDOM(movie.id, initialCounts);
        var $ratings = $('<div class="mdblist-rc-ratings"></div>');
        renderRatingsDOM($ratings, initialRatingsMap);

        $root.append($pills);
        $root.append($ratings);

        syncSpatialCollection(render, activity);

        fetchMdblistData(movie, function(apiData) {
            if (!$root.closest('body').length) return;
            var finalRatingsMap = normalizeRatings(apiData, movie);
            var finalCounts = computeGaussianReactions(finalRatingsMap, movie);
            updateReactionsDOM($pills, movie.id, finalCounts);
            renderRatingsDOM($ratings, finalRatingsMap);
        });
    }

    function startPlugin() {
        if (window.mdblist_reactions_started) return;
        window.mdblist_reactions_started = true;
        registerManifest();
        injectStyles();
        if (window.Lampa && Lampa.Listener) {
            Lampa.Listener.follow('full', onFullEvent);
        }
    }

    if (window.appready) {
        startPlugin();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function(e) {
            if (e && e.type === 'ready') {
                startPlugin();
            }
        });
    }
})();
