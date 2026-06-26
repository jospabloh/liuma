const isNode = typeof window === 'undefined';
const windowObj = isNode ? { localStorage: new Map() } : window;
const storage = windowObj.localStorage;

const toSnakeCase = (str) => {
	return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false } = {}) => {
	if (isNode) {
		return defaultValue;
	}
	const storageKey = `base44_${toSnakeCase(paramName)}`;
	const urlParams = new URLSearchParams(window.location.search);
	const searchParam = urlParams.get(paramName);
	if (removeFromUrl) {
		urlParams.delete(paramName);
		const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ""
			}${window.location.hash}`;
		window.history.replaceState({}, document.title, newUrl);
	}
	if (searchParam) {
		storage.setItem(storageKey, searchParam);
		return searchParam;
	}
	if (defaultValue) {
		storage.setItem(storageKey, defaultValue);
		return defaultValue;
	}
	const storedValue = storage.getItem(storageKey);
	if (storedValue) {
		return storedValue;
	}
	return null;
}

const getAppParams = () => {
	// `clear_access_token` is a ONE-SHOT signal Base44 appends to the URL on logout.
	// It must be read straight from the URL and stripped — never cached. The generic
	// getAppParamValue() persists every param it reads to localStorage, so reading
	// the flag through it left `base44_clear_access_token=true` stuck forever, which
	// wiped the saved token on every later load. Effect: the first tab survived
	// (its login URL re-saved the token after the wipe), but any NEW tab — which
	// carries no `?access_token` — loaded with the token already removed and was
	// forced to re-authenticate. Read + act + strip here, and purge any flag a
	// previous build left behind.
	if (!isNode) {
		const urlParams = new URLSearchParams(window.location.search);
		if (urlParams.get('clear_access_token') === 'true') {
			storage.removeItem('base44_access_token');
			storage.removeItem('token');
			urlParams.delete('clear_access_token');
			const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ''}${window.location.hash}`;
			window.history.replaceState({}, document.title, newUrl);
		}
		storage.removeItem('base44_clear_access_token'); // undo prior sticky caching
	}
	return {
		appId: getAppParamValue("app_id", { defaultValue: import.meta.env.VITE_BASE44_APP_ID }),
		token: getAppParamValue("access_token", { removeFromUrl: true }),
		fromUrl: getAppParamValue("from_url", { defaultValue: window.location.href }),
		functionsVersion: getAppParamValue("functions_version", { defaultValue: import.meta.env.VITE_BASE44_FUNCTIONS_VERSION }),
		appBaseUrl: getAppParamValue("app_base_url", { defaultValue: import.meta.env.VITE_BASE44_APP_BASE_URL }),
	}
}


export const appParams = {
	...getAppParams()
}
