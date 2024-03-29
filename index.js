const semver = require('semver');

// eslint-disable-next-line no-undef
addEventListener('fetch', event => {
	event.respondWith(handleRequest(event));
});

function createErrorResponse(message, status = 400) {
	// eslint-disable-next-line no-undef
	return new Response(JSON.stringify({
		success: false,
		message
	}), {
		headers: {
			'content-type': 'application/json'
		},
		status
	});
}

async function handleRequest(event) {
	var request = event.request;
	var path = new URL(request.url).pathname;
	var routes = {
		'/get-location': handleGetLocation,
		'/update-version': handleUpdateVersion,
		'/latest-version': handleLatestVersion,
		'/latest-download': handleLatestDownload,
		'/clear-cache': handleClearCache
	};

	if (Object.keys(routes).includes(path)) {
		return routes[path](request, event);
	} else {
		return createErrorResponse('API route does not exist', 404);
	}
}

async function handleGetLocation(request) {
	var data = {};
	data.success = true;
	data.country = request.cf.country;
	data.city = request.cf.city;
	data.continent = request.cf.continent;

	// eslint-disable-next-line no-undef
	return new Response(JSON.stringify(data), {
		headers: {
			'content-type': 'application/json;charset=UTF-8'
		}
	});
}

function getParameterByName(name, url) {
	// eslint-disable-next-line no-useless-escape
	name = name.replace(/[\[\]]/g, '\\$&');
	// eslint-disable-next-line prefer-template
	var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
		results = regex.exec(url);
	if (!results) return null;
	if (!results[2]) return '';
	return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

function getLatestVersion(arr) {
	let sortedArr = [...arr].sort((a, b) => semver.gt(a, b) ? 1 : -1);
	return sortedArr[sortedArr.length - 1];
}

async function handleLatestVersion(request, event) {
	if (!getParameterByName('version', request.url)) {
		return createErrorResponse('Version is required');
	}

	var version = getParameterByName('version', request.url);
	var regex = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9a-zA-Z.]+)?$/;

	if (!version.match(regex)) {
		return createErrorResponse('Invalid version');
	}

	const url = new URL(request.url);
	const CACHE_URL = `https://${url.hostname}/latest-version?version=${version}`;
	// eslint-disable-next-line no-undef
	const cache = caches.default;

	let response = await cache.match(CACHE_URL);

	if (!response) {
		// eslint-disable-next-line no-undef
		var allVersions = await FRAMEDKV.get('all-versions');

		if (!allVersions) {
			return createErrorResponse('No versions exist', 500);
		} else {
			allVersions = JSON.parse(allVersions);
		}

		if (!Object.keys(allVersions).includes(version)) {
			return createErrorResponse('Version does not exist');
		}

		var branch = allVersions[version];
		var latestVersion = null;
		var betaHasNewerStable = false;

		var stableVersions = [];
		var betaVersions = [];

		for (var v in allVersions) {
			switch (allVersions[v]) {
				case 'stable':
					stableVersions.push(v);
					break;
				case 'beta':
					betaVersions.push(v);
					break;
			}
		}

		switch (branch) {
			case 'stable':
				latestVersion = getLatestVersion(stableVersions);
				break;
			case 'beta':
				latestVersion = getLatestVersion(betaVersions);
				// eslint-disable-next-line no-case-declarations
				let latestStable = getLatestVersion(stableVersions);
				if (latestStable && semver.gt(latestStable, latestVersion)) {
					betaHasNewerStable = true;
					latestVersion = latestStable;
				}
				break;
		}

		// eslint-disable-next-line no-undef
		response = new Response(JSON.stringify({
			success: true,
			message: latestVersion,
			branch,
			newer: semver.gt(latestVersion, version),
			betaHasNewerStable
		}), {
			headers: {
				'content-type': 'application/json;charset=UTF-8'
			}
		});

		event.waitUntil(cache.put(CACHE_URL, response.clone()));
	}

	return response;
}

async function handleUpdateVersion(request, event) {
	if (request.method !== 'POST') {
		return createErrorResponse('This route only supports POST', 405);
	}

	if (!getParameterByName('key', request.url)) {
		return createErrorResponse('Key value is required', 403);
	}

	// eslint-disable-next-line no-undef
	if (getParameterByName('key', request.url) !== SECRET_KEY) {
		return createErrorResponse('Invalid key', 403);
	}

	var requestData = await request.json();
	var releaseData = requestData.release;
	var tag = releaseData.tag_name;
	var branch = releaseData.prerelease ? 'beta' : 'stable';
	var regex = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9a-zA-Z.]+)?$/;

	if (releaseData.draft) {
		// Return 200 so GitHub Actions don't error
		// Just need drafts ignored
		return createErrorResponse('That\'s a draft', 200);
	}

	if (!tag.match(regex)) {
		return createErrorResponse('Invalid version');
	}

	// eslint-disable-next-line no-undef
	var allVersions = await FRAMEDKV.get('all-versions');

	if (!allVersions) {
		allVersions = {};
	} else {
		allVersions = JSON.parse(allVersions);
	}

	if (Object.keys(allVersions).includes(tag)) {
		return createErrorResponse('Version already exists');
	}

	allVersions[tag] = branch;

	// eslint-disable-next-line no-undef
	await FRAMEDKV.put('all-versions', JSON.stringify(allVersions));

	event.waitUntil(_callCachePurgeApi());

	// eslint-disable-next-line no-undef
	return new Response(JSON.stringify({
		success: true,
		message: 'Version updated'
	}), {
		headers: {
			'content-type': 'application/json;charset=UTF-8'
		}
	});
}

async function handleLatestDownload(request, event) {
	const url = new URL(request.url);
	const CACHE_URL = `https://${url.hostname}/download-version`;
	// eslint-disable-next-line no-undef
	const cache = caches.default;

	let response = await cache.match(CACHE_URL);

	if (!response) {
		// eslint-disable-next-line no-undef
		var allVersions = await FRAMEDKV.get('all-versions');
		var branchVersions = {
			beta: [],
			stable: []
		};
		var useBranch = 'stable';

		if (!allVersions) {
			allVersions = {};
		} else {
			allVersions = JSON.parse(allVersions);
		}

		for (var version in allVersions) {
			branchVersions[allVersions[version]].push(version);
		}

		useBranch = branchVersions.stable.length > 0 ? 'stable' : 'beta';

		if (branchVersions[useBranch].length === 0) {
			return createErrorResponse('No versions exist');
		}

		var returnVersion = getLatestVersion(branchVersions[useBranch]);

		// eslint-disable-next-line no-undef
		response = new Response(JSON.stringify({
			success: returnVersion ? true : false,
			version: returnVersion,
			branch: useBranch
		}), {
			headers: {
				'content-type': 'application/json;charset=UTF-8',
				'Access-Control-Allow-Origin': 'https://framed-app.com'
			}
		});

		event.waitUntil(cache.put(CACHE_URL, response.clone()));
	}

	return response;
}

async function handleClearCache(request) {
	if (request.method !== 'POST') {
		return createErrorResponse('This route only supports POST', 405);
	}

	if (!getParameterByName('key', request.url)) {
		return createErrorResponse('Key value is required', 403);
	}

	// eslint-disable-next-line no-undef
	if (getParameterByName('key', request.url) !== SECRET_KEY) {
		return createErrorResponse('Invalid key', 403);
	}

	var resp = _callCachePurgeApi();

	return resp;
}

async function _callCachePurgeApi() {
	// cache.delete() works per datacenter, which is not suitable for cache invalidation
	// eslint-disable-next-line no-undef
	return fetch('https://api.cloudflare.com/client/v4/zones/e26eaf207678247b36fc4e322c276f01/purge_cache', {
		method: 'POST',
		headers: {
			// eslint-disable-next-line no-undef
			Authorization: `Bearer ${CF_AUTH_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			purge_everything: true
		})
	});
}