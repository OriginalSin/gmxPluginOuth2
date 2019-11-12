
const	_self = self || window,
		serverBase = (_self.serverBase || 'maps.kosmosnimki.ru').replace(/http.*:\/\//, '').replace(/\//g, ''),
		serverProxy = serverBase + 'Plugins/ForestReport/proxy';

let _app = {},
	loaderStatus = {},
	_sessionKeys = {},
	str = self.location.origin || '',
	_protocol = str.substring(0, str.indexOf('/')),
	syncParams = {},
	fetchOptions = {
		// method: 'post',
		// headers: {'Content-type': 'application/x-www-form-urlencoded'},
		mode: 'cors',
		redirect: 'follow',
		credentials: 'include'
	};

const parseURLParams = (str) => {
	let sp = new URLSearchParams(str || location.search),
		out = {},
		arr = [];
	for (let p of sp) {
		let k = p[0], z = p[1];
		if (z) {
			if (!out[k]) {out[k] = [];}
			out[k].push(z);
		} else {
			arr.push(k);
		}
	}
	return {main: arr, keys: out};
};
let utils = {
	extend: function (dest) {
		var i, j, len, src;

		for (j = 1, len = arguments.length; j < len; j++) {
			src = arguments[j];
			for (i in src) {
				dest[i] = src[i];
			}
		}
		return dest;
	},

	makeTileKeys: function(it, ptiles) {
		var tklen = it.tilesOrder.length,
			arr = it.tiles,
			tiles = {},
			newTiles = {};

		while (arr.length) {
			var t = arr.splice(0, tklen),
				tk = t.join('_'),
				tile = ptiles[tk];
			if (!tile || !tile.data) {
				if (!tile) {
					tiles[tk] = {
						tp: {z: t[0], x: t[1], y: t[2], v: t[3], s: t[4], d: t[5]}
					};
				} else {
					tiles[tk] = tile;
				}
				newTiles[tk] = true;
			} else {
				tiles[tk] = tile;
			}
		}
		return {tiles: tiles, newTiles: newTiles};
	},

	getDataSource: function(id, hostName) {
		// var maps = gmx._maps[hostName];
		// for (var mID in maps) {
			// var ds = maps[mID].dataSources[id];
			// if (ds) { return ds; }
		// }
		return null;
	},

	getZoomRange: function(info) {
		var arr = info.properties.styles,
			out = [40, 0];
		for (var i = 0, len = arr.length; i < len; i++) {
			var st = arr[i];
			out[0] = Math.min(out[0], st.MinZoom);
			out[1] = Math.max(out[1], st.MaxZoom);
		}
		out[0] = out[0] === 40 ? 1 : out[0];
		out[1] = out[1] === 0 ? 22 : out[1];
		return out;
	},

	chkProtocol: function(url) {
		return url.substr(0, _protocol.length) === _protocol ? url : _protocol + url;
	},
	getFormBody: function(par) {
		return Object.keys(par).map(function(key) { return encodeURIComponent(key) + '=' + encodeURIComponent(par[key]); }).join('&');
	},
	chkResponse: function(resp, type) {
		if (resp.status < 200 || resp.status >= 300) {						// error
			return Promise.reject(resp);
		} else {
			var contentType = resp.headers.get('Content-Type');
			if (type === 'bitmap') {												// get blob
				return resp.blob();
			} else if (contentType.indexOf('application/json') > -1) {				// application/json; charset=utf-8
				return resp.json();
			} else if (contentType.indexOf('text/javascript') > -1) {	 			// text/javascript; charset=utf-8
				return resp.text();
			// } else if (contentType.indexOf('application/json') > -1) {	 		// application/json; charset=utf-8
				// ret = resp.text();
			// } else if (contentType.indexOf('application/json') > -1) {	 		// application/json; charset=utf-8
				// ret = resp.formData();
			// } else if (contentType.indexOf('application/json') > -1) {	 		// application/json; charset=utf-8
				// ret = resp.arrayBuffer();
			// } else {
			}
		}
		return resp.text();
	},
	// getJson: function(url, params, options) {
	getJson: function(queue) {
// log('getJson', _protocol, queue, Date.now())
		var par = utils.extend({}, queue.params, syncParams),
			options = queue.options || {},
			opt = utils.extend({
				method: 'post',
				headers: {'Content-type': 'application/x-www-form-urlencoded'}
				// mode: 'cors',
				// redirect: 'follow',
				// credentials: 'include'
			}, fetchOptions, options, {
				body: utils.getFormBody(par)
			});
		return fetch(utils.chkProtocol(queue.url), opt)
		.then(function(res) {
			return utils.chkResponse(res, options.type);
		})
		.then(function(res) {
			var out = {url: queue.url, queue: queue, load: true, res: res};
			// if (queue.send) {
				// handler.workerContext.postMessage(out);
			// } else {
				return out;
			// }
		})
		.catch(function(err) {
			return {url: queue.url, queue: queue, load: false, error: err.toString()};
			// handler.workerContext.postMessage(out);
		});
    },

    parseLayerProps: function(prop) {
		let ph = utils.getTileAttributes(prop);
		return utils.extend(
			{
				properties: prop
			},
			utils.getTileAttributes(prop),
			utils.parseMetaProps(prop)
		);
		
		
		return ph;
    },

    parseMetaProps: function(prop) {
        var meta = prop.MetaProperties || {},
            ph = {};
        ph.dataSource = prop.dataSource || prop.LayerID;
		if ('parentLayer' in meta) {								// изменить dataSource через MetaProperties
			ph.dataSource = meta.parentLayer.Value || '';
		}
		[
			'srs',					// проекция слоя
			'gmxProxy',				// установка прокачивалки
			'filter',				// фильтр слоя
			'isGeneralized',		// флаг generalization
			'isFlatten',			// флаг flatten
			'multiFilters',			// проверка всех фильтров для обьектов слоя
			'showScreenTiles',		// показывать границы экранных тайлов
			'dateBegin',			// фильтр по дате начало периода
			'dateEnd',				// фильтр по дате окончание периода
			'shiftX',				// сдвиг всего слоя
			'shiftY',				// сдвиг всего слоя
			'shiftXfield',			// сдвиг растров объектов слоя
			'shiftYfield',			// сдвиг растров объектов слоя
			'quicklookPlatform',	// тип спутника
			'quicklookX1',			// точки привязки снимка
			'quicklookY1',			// точки привязки снимка
			'quicklookX2',			// точки привязки снимка
			'quicklookY2',			// точки привязки снимка
			'quicklookX3',			// точки привязки снимка
			'quicklookY3',			// точки привязки снимка
			'quicklookX4',			// точки привязки снимка
			'quicklookY4'			// точки привязки снимка
		].forEach((k) => {
			ph[k] = k in meta ? meta[k].Value : '';
		});
		if (ph.gmxProxy.toLowerCase() === 'true') {    // проверка прокачивалки
			ph.gmxProxy = L.gmx.gmxProxy;
		}
		if ('parentLayer' in meta) {  // фильтр слоя		// todo удалить после изменений вов вьювере
			ph.dataSource = meta.parentLayer.Value || prop.dataSource || '';
		}

        return ph;
    },

    getTileAttributes: function(prop) {
        var tileAttributeIndexes = {},
            tileAttributeTypes = {};
        if (prop.attributes) {
            var attrs = prop.attributes,
                attrTypes = prop.attrTypes || null;
            if (prop.identityField) { tileAttributeIndexes[prop.identityField] = 0; }
            for (var a = 0; a < attrs.length; a++) {
                var key = attrs[a];
                tileAttributeIndexes[key] = a + 1;
                tileAttributeTypes[key] = attrTypes ? attrTypes[a] : 'string';
            }
        }
        return {
            tileAttributeTypes: tileAttributeTypes,
            tileAttributeIndexes: tileAttributeIndexes
        };
    }
};
/*
const requestSessionKey = (serverHost, apiKey) => {
	let keys = _sessionKeys;
	if (!(serverHost in keys)) {
		keys[serverHost] = new Promise(function(resolve, reject) {
			if (apiKey) {
				utils.getJson({
					url: '//' + serverHost + '/ApiKey.ashx',
					params: {WrapStyle: 'None', Key: apiKey}
				})
					.then(function(json) {
						let res = json.res;
						if (res.Status === 'ok' && res.Result) {
							resolve(res.Result.Key !== 'null' ? '' : res.Result.Key);
						} else {
							reject(json);
						}
					})
					.catch(function() {
						resolve('');
					});
			} else {
				resolve('');
			}
		});
	}
	return keys[serverHost];
};
*/
let _maps = {};
const getMapTree = (pars) => {
	pars = pars || {};
	let hostName = pars.hostName || serverBase,
		id = pars.mapId;
	return utils.getJson({
		url: '//' + hostName + '/Map/GetMapFolder',
		// options: {},
		params: {
			srs: 3857, 
			skipTiles: 'All',

			mapId: id,
			folderId: 'root',
			visibleItemOnly: false
		}
	})
		.then(function(json) {
			let out = parseTree(json.res);
			_maps[hostName] = _maps[hostName] || {};
			_maps[hostName][id] = out;
			return parseTree(out);
		});
};

const _iterateNodeChilds = (node, level, out) => {
	level = level || 0;
	out = out || {
		layers: []
	};
	
	if (node) {
		let type = node.type,
			content = node.content,
			props = content.properties;
		if (type === 'layer') {
			let ph = utils.parseLayerProps(props);
			ph.level = level;
			if (content.geometry) { ph.geometry = content.geometry; }
			out.layers.push(ph);
		} else if (type === 'group') {
			let childs = content.children || [];
			out.layers.push({ level: level, group: true, childsLen: childs.length, properties: props });
			childs.map((it) => {
				_iterateNodeChilds(it, level + 1, out);
			});
		}
		
	} else {
		return out;
	}
	return out;
};

const parseTree = (json) => {
	let out = {};
	if (json.Status === 'error') {
		out = json;
	} else if (json.Result && json.Result.content) {
		out = _iterateNodeChilds(json.Result);
		out.mapAttr = out.layers.shift();
	}
// console.log('______json_out_______', out, json)
	return out;
};
const getReq = url => {
	return fetch(url, {
			method: 'get',
			mode: 'cors',
			credentials: 'include'
		// headers: {'Accept': 'application/json'},
		// body: JSON.stringify(params)	// TODO: сервер почему то не хочет работать так https://googlechrome.github.io/samples/fetch-api/fetch-post.html
		})
		.then(res => res.json())
		.catch(err => console.warn(err));
};

// const getLayerItems = (params) => {
	// params = params || {};

	// let url = `${serverBase}VectorLayer/Search.ashx`;
	// url += '?layer=' + params.layerID;
	// if (params.id) { '&query=gmx_id=' + params.id; }

	// url += '&out_cs=EPSG:4326';
	// url += '&geometry=true';
	// return getReq(url);
// };
// const getReportsCount = () => {
	// return getReq(serverProxy + '?path=/rest/v1/get-current-user-info');
// };

let dataSources = {},
	loaderStatus1 = {};

const addDataSource = (pars) => {
	pars = pars || {};

	let id = pars.id;
	if (id) {
		let hostName = pars.hostName;
		
	} else {
		console.warn('Warning: Specify layer \'id\' and \'hostName\`', pars);
	}
	return;
};

const removeDataSource = (pars) => {
	pars = pars || {};

	let id = pars.id;
	if (id) {
		let hostName = pars.hostName;
		
	} else {
		console.warn('Warning: Specify layer \'id\' and \'hostName\`', pars);
	}
	//Requests.removeDataSource({id: message.layerID, hostName: message.hostName}).then((json) => {
	return;
};

const getColumnStat = (pars) => {
	pars = pars || {};
	let hostName = pars.hostName || serverBase;
	return utils.getJson({
		url: '//' + hostName + '/VectorLayer/GetColumnStat',
		params: {
			layerID: pars.id,
			column: pars.column,
			maxUnique: 10000,
			unique: true
		}
	});
};

const chkTask = (id) => {
	const UPDATE_INTERVAL = 2000;
	let hostName = serverBase;
	return new Promise((resolve, reject) => {
		let interval = setInterval(() => {
			fetch('//' + hostName + '/AsyncTask.ashx?WrapStyle=None&TaskID=' + id,
			{
				mode: 'cors',
				credentials: 'include'
			})
				.then(res => res.json())
				.then(json => {
					const { Completed, ErrorInfo } = json.Result;
					if (ErrorInfo) {
						clearInterval(interval);
						reject(json);
					} else if (Completed) {
						clearInterval(interval);
						resolve(json);
					}
				});
		}, UPDATE_INTERVAL);
	});
};

const createFilterLayer = (pars, opt) => {
	pars = pars || {};
	opt = opt || {};
	let hostName = pars.hostName || serverBase,
		styles = pars.styles;
	return new Promise((resolve) => {
		utils.getJson({
			url: '//' + hostName + '/VectorLayer/Insert.ashx',
			// options: {},
			params: pars
		})
		.then((json) => {
			//console.log('createFilterLayer________', json);
			if (json.res.Status === 'ok') {
				chkTask(json.res.Result.TaskID)
				.then(json => {
					if (json.Status === 'ok') {
						let contentNode = { type: 'layer', content: json.Result.Result };
						delete contentNode.content.geometry;
						let LayerID = contentNode.content.properties.LayerID;
						window._layersTree.copyHandler(contentNode, $( window._queryMapLayers.buildedTree.firstChild).children("div[MapID]")[0], false, true, () => {
							let LayerID = contentNode.content.properties.LayerID;
							let div = $(window._queryMapLayers.buildedTree).find("div[LayerID='" + LayerID + "']")[0];
							div.gmxProperties.content.properties.styles = styles;
							window._mapHelper.updateMapStyles(styles, LayerID);
							resolve(contentNode);
						});
					}
				})
				.catch(err => console.log(err));
			}
		})
		.catch(err => console.log(err));
	});
};

const downloadLayer = (node, id) => {
	node.setAttribute('href', new URL('/DownloadVector?format=csv&layer=' + id, location.protocol + '//' + serverBase));
return;
		return fetch('//' + serverBase + '/DownloadVector?format=csv&layer=' + id, {
			// method: 'post',
			
			// headers: {'Content-type': 'application/octet-stream'},
			headers: {'Content-type': 'multipart/form-data'},
			mode: 'cors',
			redirect: 'follow',
			credentials: 'include'
		})
		.then((req) => req.blob())
		.then((blob) => {
			//node.setAttribute('href', window.URL.createObjectURL(blob));
			var url = window.URL.createObjectURL(blob);
			window.location.href = url;
			/*
            var a = document.createElement('a');
            a.href = url;
            // a.download = "filename.xlsx";
            document.body.appendChild(a); // we need to append the element to the dom -> otherwise it will not work in firefox
            a.click();    
            a.remove();  //afterwards we remove the element again  
			*/
		});
/*
		var par = utils.extend({}, queue.params, syncParams),
			options = queue.options || {},
			opt = utils.extend({
				method: 'post',
				headers: {'Content-type': 'application/x-www-form-urlencoded'}
				// mode: 'cors',
				// redirect: 'follow',
				// credentials: 'include'
			}, fetchOptions, options, {
				body: utils.getFormBody(par)
			});
	return new Promise((resolve) => {
		utils.getJson({
			// url: '//' + hostName + '/DownloadLayer.ashx',
			url: '//' + serverBase + '/DownloadVector',
			// options: {},
			params: {
				format: 'csv',
				layer: id
			}
		})
		.then((json) => {
			// console.log('DownloadVector', json);
			// let blob = new Blob([JSON.stringify(features, null, '\t')], {type: 'text/json;charset=utf-8;'});
				//blob = new Blob([JSON.stringify(features, null, '\t')], {type: type});
			node.setAttribute('href', window.URL.createObjectURL(json.res));
			
			// if (json.res.Status === 'ok') {
				// chkTask(json.res.Result.TaskID)
				// .then(json => {
					// if (json.Status === 'ok') {
						// let contentNode = { type: 'layer', content: json.Result.Result };
						// delete contentNode.content.geometry;
						// let LayerID = contentNode.content.properties.LayerID;
						// window._layersTree.copyHandler(contentNode, $( window._queryMapLayers.buildedTree.firstChild).children("div[MapID]")[0], false, true, () => {
							// resolve(contentNode);
						// });
					// }
				// })
				// .catch(err => console.log(err));
			// }
		})
		.catch(err => console.log(err));
	});
	*/
};

export default {
	downloadLayer,
	getColumnStat,
	createFilterLayer,

	addDataSource,
	removeDataSource,
	parseURLParams,
	getMapTree,
	// getReportsCount,
	// getLayerItems
};