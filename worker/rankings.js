/**
 * Rankings API — D1-backed leaderboard for 3 games
 * One universal ID per player, stores best scores for all games.
 */

export async function rankingsFetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // POST /api/rankings — upsert (create or update scores)
    if (method === 'POST' && path === '/api/rankings') {
        return handleUpsert(request, env);
    }

    // GET /api/rankings/top?game=flappy|piano|hearts — top 10
    // Must be checked BEFORE the generic /:id route, otherwise "top" is
    // captured as an id and misrouted to handleGet.
    if (method === 'GET' && path === '/api/rankings/top') {
        return handleTop(url, env);
    }

    // GET /api/rankings/:id — get own record
    const getMatch = path.match(/^\/api\/rankings\/([^/]+)$/);
    if (method === 'GET' && getMatch) {
        return handleGet(getMatch[1], env);
    }

    // PUT /api/rankings/:id — change name (new id generated)
    if (method === 'PUT' && getMatch) {
        return handleRename(getMatch[1], request, env);
    }

    return new Response('Not Found', { status: 404 });
}

// POST /api/rankings — upsert
async function handleUpsert(request, env) {
    try {
        const { id, name, flappy_best, piano_best, hearts_best } = await request.json();

        if (!id || !name) {
            return jsonResponse({ error: 'Missing id or name' }, 400);
        }

        const stmt = env.MAIL_DB.prepare(`
            INSERT INTO rankings (id, name, flappy_best, piano_best, hearts_best, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                flappy_best = MAX(rankings.flappy_best, excluded.flappy_best),
                piano_best = MAX(rankings.piano_best, excluded.piano_best),
                hearts_best = MAX(rankings.hearts_best, excluded.hearts_best),
                updated_at = datetime('now')
        `);

        await env.MAIL_DB.batch([
            stmt.bind(id, name, flappy_best || 0, piano_best || 0, hearts_best || 0)
        ]);

        return jsonResponse({ ok: true, id });
    } catch (err) {
        return jsonResponse({ error: err.message }, 500);
    }
}

// GET /api/rankings/:id
async function handleGet(id, env) {
    try {
        const { results } = await env.MAIL_DB.prepare(
            'SELECT * FROM rankings WHERE id = ?1'
        ).bind(id).all();

        if (results.length === 0) {
            return jsonResponse({ found: false }, 200);
        }

        return jsonResponse({ found: true, ranking: results[0] });
    } catch (err) {
        return jsonResponse({ error: err.message }, 500);
    }
}

// PUT /api/rankings/:id — rename
async function handleRename(id, request, env) {
    try {
        const { new_id, new_name } = await request.json();

        if (!new_id || !new_name) {
            return jsonResponse({ error: 'Missing new_id or new_name' }, 400);
        }

        // Fetch existing record
        const { results } = await env.MAIL_DB.prepare(
            'SELECT * FROM rankings WHERE id = ?1'
        ).bind(id).all();

        if (results.length === 0) {
            return jsonResponse({ error: 'Not found' }, 404);
        }

        const r = results[0];

        // Insert with new id, keep scores
        await env.MAIL_DB.batch([
            env.MAIL_DB.prepare(`
                INSERT INTO rankings (id, name, flappy_best, piano_best, hearts_best, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    flappy_best = MAX(rankings.flappy_best, excluded.flappy_best),
                    piano_best = MAX(rankings.piano_best, excluded.piano_best),
                    hearts_best = MAX(rankings.hearts_best, excluded.hearts_best),
                    updated_at = datetime('now')
            `).bind(new_id, new_name, r.flappy_best, r.piano_best, r.hearts_best),
            env.MAIL_DB.prepare('DELETE FROM rankings WHERE id = ?1').bind(id)
        ]);

        return jsonResponse({ ok: true, id: new_id });
    } catch (err) {
        return jsonResponse({ error: err.message }, 500);
    }
}

// GET /api/rankings/top?game=flappy|piano|hearts
async function handleTop(url, env) {
    try {
        const game = url.searchParams.get('game');
        const validGames = { flappy: 'flappy_best', piano: 'piano_best', hearts: 'hearts_best' };
        const column = validGames[game];

        if (!column) {
            return jsonResponse({ error: 'Invalid game. Use: flappy, piano, hearts' }, 400);
        }

        const { results } = await env.MAIL_DB.prepare(
            `SELECT id, name, ${column} as score FROM rankings WHERE ${column} > 0 ORDER BY ${column} DESC LIMIT 10`
        ).all();

        return jsonResponse({ top: results });
    } catch (err) {
        return jsonResponse({ error: err.message }, 500);
    }
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
