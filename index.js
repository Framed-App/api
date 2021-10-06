addEventListener('fetch', event => {
	event.respondWith(handleRequest(event.request));
});

function createErrorResponse(message, status = 400) {
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

async function handleRequest(request) {
	var path = new URL(request.url).pathname;
	var routes = {
		'/get-location': handleGetLocation,
		'/update-version': handleUpdateVersion,
		'/latest-version': handleLatestVersion
	};

	if (Object.keys(routes).includes(path)) {
		return routes[path](request);
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

async function handleLatestVersion(request) {
	if (!getParameterByName('version', request.url)) {
		return createErrorResponse('Version is required');
	}

	var version = getParameterByName('version', request.url);
	var regex = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9a-zA-Z.]+)?$/;

	if (!version.match(regex)) {
		return createErrorResponse('Invalid version');
	}

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

	switch (branch) {
		case 'stable':
			// eslint-disable-next-line no-undef
			latestVersion = await FRAMEDKV.get('latest-stable');
			break;
		case 'beta':
			// eslint-disable-next-line no-undef
			latestVersion = await FRAMEDKV.get('latest-beta');
			break;
	}

	return new Response(JSON.stringify({
		success: true,
		message: latestVersion,
		branch,
		newer: latestVersion > version
	}), {
		headers: {
			'content-type': 'application/json;charset=UTF-8'
		}
	});
}

async function handleUpdateVersion(request) {
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

	if (!tag.match(regex)) {
		return createErrorResponse('Invaild version');
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

	switch (branch) {
		case 'stable':
			// eslint-disable-next-line no-undef
			await FRAMEDKV.put('latest-stable', tag);
			break;
		case 'beta':
			// eslint-disable-next-line no-undef
			await FRAMEDKV.put('latest-beta', tag);
			break;
	}

	return new Response(JSON.stringify({
		success: true,
		message: 'Version updated'
	}), {
		headers: {
			'content-type': 'application/json;charset=UTF-8'
		}
	});
}