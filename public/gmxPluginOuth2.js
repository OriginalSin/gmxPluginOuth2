var gmxDomRF = (function (exports) {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    const has_prop = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.data !== data)
            text.data = data;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function add_flush_callback(fn) {
        flush_callbacks.push(fn);
    }
    function flush() {
        const seen_callbacks = new Set();
        do {
            // first, call beforeUpdate functions
            // and update components
            while (dirty_components.length) {
                const component = dirty_components.shift();
                set_current_component(component);
                update(component.$$);
            }
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    callback();
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update($$.dirty);
            run_all($$.before_update);
            $$.fragment && $$.fragment.p($$.dirty, $$.ctx);
            $$.dirty = null;
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }

    const globals = (typeof window !== 'undefined' ? window : global);

    function bind(component, name, callback) {
        if (has_prop(component.$$.props, name)) {
            name = component.$$.props[name] || name;
            component.$$.bound[name] = callback;
            callback(component.$$.ctx[name]);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = {};
        }
    }
    function make_dirty(component, key) {
        if (!component.$$.dirty) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty = blank_object();
        }
        component.$$.dirty[key] = true;
    }
    function init(component, options, instance, create_fragment, not_equal, props) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty: null
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (key, ret, value = ret) => {
                if ($$.ctx && not_equal($$.ctx[key], $$.ctx[key] = value)) {
                    if ($$.bound[key])
                        $$.bound[key](value);
                    if (ready)
                        make_dirty(component, key);
                }
                return ret;
            })
            : prop_values;
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(children(options.target));
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    const subscriber_queue = [];
    /**
     * Create a `Writable` store that allows both updating and reading by subscription.
     * @param {*=}value initial value
     * @param {StartStopNotifier=}start start and stop notifications for subscriptions
     */
    function writable(value, start = noop) {
        let stop;
        const subscribers = [];
        function set(new_value) {
            if (safe_not_equal(value, new_value)) {
                value = new_value;
                if (stop) { // store is ready
                    const run_queue = !subscriber_queue.length;
                    for (let i = 0; i < subscribers.length; i += 1) {
                        const s = subscribers[i];
                        s[1]();
                        subscriber_queue.push(s, value);
                    }
                    if (run_queue) {
                        for (let i = 0; i < subscriber_queue.length; i += 2) {
                            subscriber_queue[i][0](subscriber_queue[i + 1]);
                        }
                        subscriber_queue.length = 0;
                    }
                }
            }
        }
        function update(fn) {
            set(fn(value));
        }
        function subscribe(run, invalidate = noop) {
            const subscriber = [run, invalidate];
            subscribers.push(subscriber);
            if (subscribers.length === 1) {
                stop = start(set) || noop;
            }
            run(value);
            return () => {
                const index = subscribers.indexOf(subscriber);
                if (index !== -1) {
                    subscribers.splice(index, 1);
                }
                if (subscribers.length === 0) {
                    stop();
                    stop = null;
                }
            };
        }
        return { set, update, subscribe };
    }

    // export const Store = {
    	// leafletMap: writable(0),
    	// baseContVisible: writable(0),
    	// mapID: writable(0),
    	// mapTree: writable(0)
    // };
    const leafletMap = writable(0);
    const gmxMap = writable(0);

    /*jslint plusplus:true */
    function Geomag(model) {
    	var wmm,
    		maxord = 12,
    		a = 6378.137,		// WGS 1984 Equatorial axis (km)
    		b = 6356.7523142,	// WGS 1984 Polar axis (km)
    		re = 6371.2,
    		a2 = a * a,
    		b2 = b * b,
    		c2 = a2 - b2,
    		a4 = a2 * a2,
    		b4 = b2 * b2,
    		c4 = a4 - b4,
    		z = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    		unnormalizedWMM;

    	function parseCof(cof) {
    		wmm = (function (cof) {
    			var modelLines = cof.split('\n'), wmm = [], i, vals, epoch, model, modelDate;
    			for (i in modelLines) {
    				if (modelLines.hasOwnProperty(i)) {
    					vals = modelLines[i].replace(/^\s+|\s+$/g, "").split(/\s+/);
    					if (vals.length === 3) {
    						epoch = parseFloat(vals[0]);
    						model = vals[1];
    						modelDate = vals[2];
    					} else if (vals.length === 6) {
    						wmm.push({
    							n: parseInt(vals[0], 10),
    							m: parseInt(vals[1], 10),
    							gnm: parseFloat(vals[2]),
    							hnm: parseFloat(vals[3]),
    							dgnm: parseFloat(vals[4]),
    							dhnm: parseFloat(vals[5])
    						});
    					}
    				}
    			}

    			return {epoch: epoch, model: model, modelDate: modelDate, wmm: wmm};
    		}(cof));
    	}

    	function unnormalize(wmm) {
    		var i, j, m, n, D2, flnmj,
    			c = [z.slice(), z.slice(), z.slice(), z.slice(), z.slice(), z.slice(),
    				z.slice(), z.slice(), z.slice(), z.slice(), z.slice(), z.slice(),
    				z.slice()],
    			cd = [z.slice(), z.slice(), z.slice(), z.slice(), z.slice(), z.slice(),
    				z.slice(), z.slice(), z.slice(), z.slice(), z.slice(), z.slice(),
    				z.slice()],
    			k = [z.slice(), z.slice(), z.slice(), z.slice(), z.slice(), z.slice(),
    				z.slice(), z.slice(), z.slice(), z.slice(), z.slice(), z.slice(),
    				z.slice()],
    			snorm = [z.slice(), z.slice(), z.slice(), z.slice(), z.slice(),
    				z.slice(), z.slice(), z.slice(), z.slice(), z.slice(), z.slice(),
    				z.slice(), z.slice()],
    			model = wmm.wmm;
    		for (i in model) {
    			if (model.hasOwnProperty(i)) {
    				if (model[i].m <= model[i].n) {
    					c[model[i].m][model[i].n] = model[i].gnm;
    					cd[model[i].m][model[i].n] = model[i].dgnm;
    					if (model[i].m !== 0) {
    						c[model[i].n][model[i].m - 1] = model[i].hnm;
    						cd[model[i].n][model[i].m - 1] = model[i].dhnm;
    					}
    				}
    			}
    		}
    		/* CONVERT SCHMIDT NORMALIZED GAUSS COEFFICIENTS TO UNNORMALIZED */
    		snorm[0][0] = 1;

    		for (n = 1; n <= maxord; n++) {
    			snorm[0][n] = snorm[0][n - 1] * (2 * n - 1) / n;
    			j = 2;

    			for (m = 0, D2 = (n - m + 1); D2 > 0; D2--, m++) {
    				k[m][n] = (((n - 1) * (n - 1)) - (m * m)) /
    					((2 * n - 1) * (2 * n - 3));
    				if (m > 0) {
    					flnmj = ((n - m + 1) * j) / (n + m);
    					snorm[m][n] = snorm[m - 1][n] * Math.sqrt(flnmj);
    					j = 1;
    					c[n][m - 1] = snorm[m][n] * c[n][m - 1];
    					cd[n][m - 1] = snorm[m][n] * cd[n][m - 1];
    				}
    				c[m][n] = snorm[m][n] * c[m][n];
    				cd[m][n] = snorm[m][n] * cd[m][n];
    			}
    		}
    		k[1][1] = 0.0;

    		unnormalizedWMM = {epoch: wmm.epoch, k: k, c: c, cd: cd};
    	}

    	this.setCof = function (cof) {
    		parseCof(cof);
    		unnormalize(wmm);
    	};
    	this.getWmm = function () {
    		return wmm;
    	};
    	this.setUnnorm = function (val) {
    		unnormalizedWMM = val;
    	};
    	this.getUnnorm = function () {
    		return unnormalizedWMM;
    	};
    	this.getEpoch = function () {
    		return unnormalizedWMM.epoch;
    	};
    	this.setEllipsoid = function (e) {
    		a = e.a;
    		b = e.b;
    		re = 6371.2;
    		a2 = a * a;
    		b2 = b * b;
    		c2 = a2 - b2;
    		a4 = a2 * a2;
    		b4 = b2 * b2;
    		c4 = a4 - b4;
    	};
    	this.getEllipsoid = function () {
    		return {a: a, b: b};
    	};
    	this.calculate = function (glat, glon, h, date) {
    		if (unnormalizedWMM === undefined) {
    			throw new Error("A World Magnetic Model has not been set.")
    		}
    		if (glat === undefined || glon === undefined) {
    			throw new Error("Latitude and longitude are required arguments.");
    		}
    		function rad2deg(rad) {
    			return rad * (180 / Math.PI);
    		}
    		function deg2rad(deg) {
    			return deg * (Math.PI / 180);
    		}
    		function decimalDate(date) {
    			date = date || new Date();
    			var year = date.getFullYear(),
    				daysInYear = 365 +
    					(((year % 400 === 0) || (year % 4 === 0 && (year % 100 > 0))) ? 1 : 0),
    				msInYear = daysInYear * 24 * 60 * 60 * 1000;

    			return date.getFullYear() + (date.valueOf() - (new Date(year, 0)).valueOf()) / msInYear;
    		}

    		var epoch = unnormalizedWMM.epoch,
    			k = unnormalizedWMM.k,
    			c = unnormalizedWMM.c,
    			cd = unnormalizedWMM.cd,
    			alt = (h / 3280.8399) || 0, // convert h (in feet) to kilometers (default, 0 km)
    			dt = decimalDate(date) - epoch,
    			rlat = deg2rad(glat),
    			rlon = deg2rad(glon),
    			srlon = Math.sin(rlon),
    			srlat = Math.sin(rlat),
    			crlon = Math.cos(rlon),
    			crlat = Math.cos(rlat),
    			srlat2 = srlat * srlat,
    			crlat2 = crlat * crlat,
    			q,
    			q1,
    			q2,
    			ct,
    			st,
    			r2,
    			r,
    			d,
    			ca,
    			sa,
    			aor,
    			ar,
    			br = 0.0,
    			bt = 0.0,
    			bp = 0.0,
    			bpp = 0.0,
    			par,
    			temp1,
    			temp2,
    			parp,
    			D4,
    			m,
    			n,
    			fn = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    			fm = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    			z = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    			tc = [z.slice(), z.slice(), z.slice(), z.slice(), z.slice(), z.slice(),
    				z.slice(), z.slice(), z.slice(), z.slice(), z.slice(), z.slice(),
    				z.slice()],
    			sp = z.slice(),
    			cp = z.slice(),
    			pp = z.slice(),
    			p = [z.slice(), z.slice(), z.slice(), z.slice(), z.slice(), z.slice(),
    				z.slice(), z.slice(), z.slice(), z.slice(), z.slice(), z.slice(),
    				z.slice()],
    			dp = [z.slice(), z.slice(), z.slice(), z.slice(), z.slice(), z.slice(),
    				z.slice(), z.slice(), z.slice(), z.slice(), z.slice(), z.slice(),
    				z.slice()],
    			bx,
    			by,
    			bz,
    			bh,
    			ti,
    			dec,
    			dip,
    			gv;
    		sp[0] = 0.0;
    		sp[1] = srlon;
    		cp[1] = crlon;
    		tc[0][0] = 0;
    		cp[0] = 1.0;
    		pp[0] = 1.0;
    		p[0][0] = 1;

    		/* CONVERT FROM GEODETIC COORDS. TO SPHERICAL COORDS. */
    		q = Math.sqrt(a2 - c2 * srlat2);
    		q1 = alt * q;
    		q2 = ((q1 + a2) / (q1 + b2)) * ((q1 + a2) / (q1 + b2));
    		ct = srlat / Math.sqrt(q2 * crlat2 + srlat2);
    		st = Math.sqrt(1.0 - (ct * ct));
    		r2 = (alt * alt) + 2.0 * q1 + (a4 - c4 * srlat2) / (q * q);
    		r = Math.sqrt(r2);
    		d = Math.sqrt(a2 * crlat2 + b2 * srlat2);
    		ca = (alt + d) / r;
    		sa = c2 * crlat * srlat / (r * d);

    		for (m = 2; m <= maxord; m++) {
    			sp[m] = sp[1] * cp[m - 1] + cp[1] * sp[m - 1];
    			cp[m] = cp[1] * cp[m - 1] - sp[1] * sp[m - 1];
    		}

    		aor = re / r;
    		ar = aor * aor;

    		for (n = 1; n <= maxord; n++) {
    			ar = ar * aor;
    			for (m = 0, D4 = (n + m + 1); D4 > 0; D4--, m++) {

    		/*
    				COMPUTE UNNORMALIZED ASSOCIATED LEGENDRE POLYNOMIALS
    				AND DERIVATIVES VIA RECURSION RELATIONS
    		*/
    				if (n === m) {
    					p[m][n] = st * p[m - 1][n - 1];
    					dp[m][n] = st * dp[m - 1][n - 1] + ct *
    						p[m - 1][n - 1];
    				} else if (n === 1 && m === 0) {
    					p[m][n] = ct * p[m][n - 1];
    					dp[m][n] = ct * dp[m][n - 1] - st * p[m][n - 1];
    				} else if (n > 1 && n !== m) {
    					if (m > n - 2) { p[m][n - 2] = 0; }
    					if (m > n - 2) { dp[m][n - 2] = 0.0; }
    					p[m][n] = ct * p[m][n - 1] - k[m][n] * p[m][n - 2];
    					dp[m][n] = ct * dp[m][n - 1] - st * p[m][n - 1] -
    						k[m][n] * dp[m][n - 2];
    				}

    		/*
    				TIME ADJUST THE GAUSS COEFFICIENTS
    		*/

    				tc[m][n] = c[m][n] + dt * cd[m][n];
    				if (m !== 0) {
    					tc[n][m - 1] = c[n][m - 1] + dt * cd[n][m - 1];
    				}

    		/*
    				ACCUMULATE TERMS OF THE SPHERICAL HARMONIC EXPANSIONS
    		*/
    				par = ar * p[m][n];
    				if (m === 0) {
    					temp1 = tc[m][n] * cp[m];
    					temp2 = tc[m][n] * sp[m];
    				} else {
    					temp1 = tc[m][n] * cp[m] + tc[n][m - 1] * sp[m];
    					temp2 = tc[m][n] * sp[m] - tc[n][m - 1] * cp[m];
    				}
    				bt = bt - ar * temp1 * dp[m][n];
    				bp += (fm[m] * temp2 * par);
    				br += (fn[n] * temp1 * par);
    		/*
    					SPECIAL CASE:  NORTH/SOUTH GEOGRAPHIC POLES
    		*/
    				if (st === 0.0 && m === 1) {
    					if (n === 1) {
    						pp[n] = pp[n - 1];
    					} else {
    						pp[n] = ct * pp[n - 1] - k[m][n] * pp[n - 2];
    					}
    					parp = ar * pp[n];
    					bpp += (fm[m] * temp2 * parp);
    				}
    			}
    		}

    		bp = (st === 0.0 ? bpp : bp / st);
    		/*
    			ROTATE MAGNETIC VECTOR COMPONENTS FROM SPHERICAL TO
    			GEODETIC COORDINATES
    		*/
    		bx = -bt * ca - br * sa;
    		by = bp;
    		bz = bt * sa - br * ca;

    		/*
    			COMPUTE DECLINATION (DEC), INCLINATION (DIP) AND
    			TOTAL INTENSITY (TI)
    		*/
    		bh = Math.sqrt((bx * bx) + (by * by));
    		ti = Math.sqrt((bh * bh) + (bz * bz));
    		dec = rad2deg(Math.atan2(by, bx));
    		dip = rad2deg(Math.atan2(bz, bh));

    		/*
    			COMPUTE MAGNETIC GRID VARIATION IF THE CURRENT
    			GEODETIC POSITION IS IN THE ARCTIC OR ANTARCTIC
    			(I.E. GLAT > +55 DEGREES OR GLAT < -55 DEGREES)
    			OTHERWISE, SET MAGNETIC GRID VARIATION TO -999.0
    		*/

    		if (Math.abs(glat) >= 55.0) {
    			if (glat > 0.0 && glon >= 0.0) {
    				gv = dec - glon;
    			} else if (glat > 0.0 && glon < 0.0) {
    				gv = dec + Math.abs(glon);
    			} else if (glat < 0.0 && glon >= 0.0) {
    				gv = dec + glon;
    			} else if (glat < 0.0 && glon < 0.0) {
    				gv = dec - Math.abs(glon);
    			}
    			if (gv > 180.0) {
    				gv -= 360.0;
    			} else if (gv < -180.0) { gv += 360.0; }
    		}

    		return {dec: dec, dip: dip, ti: ti, bh: bh, bx: bx, by: by, bz: bz, lat: glat, lon: glon, gv: gv};
    	};
    	this.calc = this.calculate;
    	this.mag = this.calculate;

    	if (model !== undefined) { // initialize
    		if (typeof model === 'string') { // WMM.COF file
    			parseCof(model);
    			unnormalize(wmm);
    		} else if (typeof model === 'object') { // unnorm obj
    			this.setUnnorm(model);
    		} else {
    			throw new Error("Invalid argument type");
    		}
    	}
    }

    var cof = `
    2010.0            WMM-2010        11/20/2009
  1  0  -29496.6       0.0       11.6        0.0
  1  1   -1586.3    4944.4       16.5      -25.9
  2  0   -2396.6       0.0      -12.1        0.0
  2  1    3026.1   -2707.7       -4.4      -22.5
  2  2    1668.6    -576.1        1.9      -11.8
  3  0    1340.1       0.0        0.4        0.0
  3  1   -2326.2    -160.2       -4.1        7.3
  3  2    1231.9     251.9       -2.9       -3.9
  3  3     634.0    -536.6       -7.7       -2.6
  4  0     912.6       0.0       -1.8        0.0
  4  1     808.9     286.4        2.3        1.1
  4  2     166.7    -211.2       -8.7        2.7
  4  3    -357.1     164.3        4.6        3.9
  4  4      89.4    -309.1       -2.1       -0.8
  5  0    -230.9       0.0       -1.0        0.0
  5  1     357.2      44.6        0.6        0.4
  5  2     200.3     188.9       -1.8        1.8
  5  3    -141.1    -118.2       -1.0        1.2
  5  4    -163.0       0.0        0.9        4.0
  5  5      -7.8     100.9        1.0       -0.6
  6  0      72.8       0.0       -0.2        0.0
  6  1      68.6     -20.8       -0.2       -0.2
  6  2      76.0      44.1       -0.1       -2.1
  6  3    -141.4      61.5        2.0       -0.4
  6  4     -22.8     -66.3       -1.7       -0.6
  6  5      13.2       3.1       -0.3        0.5
  6  6     -77.9      55.0        1.7        0.9
  7  0      80.5       0.0        0.1        0.0
  7  1     -75.1     -57.9       -0.1        0.7
  7  2      -4.7     -21.1       -0.6        0.3
  7  3      45.3       6.5        1.3       -0.1
  7  4      13.9      24.9        0.4       -0.1
  7  5      10.4       7.0        0.3       -0.8
  7  6       1.7     -27.7       -0.7       -0.3
  7  7       4.9      -3.3        0.6        0.3
  8  0      24.4       0.0       -0.1        0.0
  8  1       8.1      11.0        0.1       -0.1
  8  2     -14.5     -20.0       -0.6        0.2
  8  3      -5.6      11.9        0.2        0.4
  8  4     -19.3     -17.4       -0.2        0.4
  8  5      11.5      16.7        0.3        0.1
  8  6      10.9       7.0        0.3       -0.1
  8  7     -14.1     -10.8       -0.6        0.4
  8  8      -3.7       1.7        0.2        0.3
  9  0       5.4       0.0       -0.0        0.0
  9  1       9.4     -20.5       -0.1       -0.0
  9  2       3.4      11.5        0.0       -0.2
  9  3      -5.2      12.8        0.3        0.0
  9  4       3.1      -7.2       -0.4       -0.1
  9  5     -12.4      -7.4       -0.3        0.1
  9  6      -0.7       8.0        0.1       -0.0
  9  7       8.4       2.1       -0.1       -0.2
  9  8      -8.5      -6.1       -0.4        0.3
  9  9     -10.1       7.0       -0.2        0.2
 10  0      -2.0       0.0        0.0        0.0
 10  1      -6.3       2.8       -0.0        0.1
 10  2       0.9      -0.1       -0.1       -0.1
 10  3      -1.1       4.7        0.2        0.0
 10  4      -0.2       4.4       -0.0       -0.1
 10  5       2.5      -7.2       -0.1       -0.1
 10  6      -0.3      -1.0       -0.2       -0.0
 10  7       2.2      -3.9        0.0       -0.1
 10  8       3.1      -2.0       -0.1       -0.2
 10  9      -1.0      -2.0       -0.2        0.0
 10 10      -2.8      -8.3       -0.2       -0.1
 11  0       3.0       0.0        0.0        0.0
 11  1      -1.5       0.2        0.0       -0.0
 11  2      -2.1       1.7       -0.0        0.1
 11  3       1.7      -0.6        0.1        0.0
 11  4      -0.5      -1.8       -0.0        0.1
 11  5       0.5       0.9        0.0        0.0
 11  6      -0.8      -0.4       -0.0        0.1
 11  7       0.4      -2.5       -0.0        0.0
 11  8       1.8      -1.3       -0.0       -0.1
 11  9       0.1      -2.1        0.0       -0.1
 11 10       0.7      -1.9       -0.1       -0.0
 11 11       3.8      -1.8       -0.0       -0.1
 12  0      -2.2       0.0       -0.0        0.0
 12  1      -0.2      -0.9        0.0       -0.0
 12  2       0.3       0.3        0.1        0.0
 12  3       1.0       2.1        0.1       -0.0
 12  4      -0.6      -2.5       -0.1        0.0
 12  5       0.9       0.5       -0.0       -0.0
 12  6      -0.1       0.6        0.0        0.1
 12  7       0.5      -0.0        0.0        0.0
 12  8      -0.4       0.1       -0.0        0.0
 12  9      -0.4       0.3        0.0       -0.0
 12 10       0.2      -0.9        0.0       -0.0
 12 11      -0.8      -0.2       -0.1        0.0
 12 12       0.0       0.9        0.1        0.0
999999999999999999999999999999999999999999999999
999999999999999999999999999999999999999999999999
`;
    var geoMag = new Geomag(cof).mag;

    const _self = self || window,
    		serverBase = (_self.serverBase || 'maps.kosmosnimki.ru').replace(/http.*:\/\//, '').replace(/\//g, '');

    let str = self.location.origin || '',
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

    var Requests = {
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

    /* src\Filters\Filters.svelte generated by Svelte v3.14.0 */

    const { Object: Object_1 } = globals;

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = Object_1.create(ctx);
    	child_ctx.pt = list[i];
    	return child_ctx;
    }

    function get_each_context(ctx, list, i) {
    	const child_ctx = Object_1.create(ctx);
    	child_ctx.field = list[i];
    	return child_ctx;
    }

    function get_each_context_2(ctx, list, i) {
    	const child_ctx = Object_1.create(ctx);
    	child_ctx.k = list[i];
    	return child_ctx;
    }

    // (226:4) {#each Object.keys(filterLayers) as k}
    function create_each_block_2(ctx) {
    	let option;
    	let t_value = ctx.filterLayers[ctx.k].title + "";
    	let t;
    	let option_value_value;

    	return {
    		c() {
    			option = element("option");
    			t = text(t_value);
    			option.__value = option_value_value = ctx.filterLayers[ctx.k].id;
    			option.value = option.__value;
    		},
    		m(target, anchor) {
    			insert(target, option, anchor);
    			append(option, t);
    		},
    		p(changed, ctx) {
    			if (changed.filterLayers && t_value !== (t_value = ctx.filterLayers[ctx.k].title + "")) set_data(t, t_value);

    			if (changed.filterLayers && option_value_value !== (option_value_value = ctx.filterLayers[ctx.k].id)) {
    				option.__value = option_value_value;
    			}

    			option.value = option.__value;
    		},
    		d(detaching) {
    			if (detaching) detach(option);
    		}
    	};
    }

    // (233:0) {#if currLayer}
    function create_if_block(ctx) {
    	let t0;
    	let div1;
    	let div0;
    	let input;
    	let label;
    	let t2;
    	let dispose;
    	let each_value = Object.keys(ctx.currLayer.filters);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	let if_block = ctx.currDrawingObj && create_if_block_1(ctx);

    	return {
    		c() {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t0 = space();
    			div1 = element("div");
    			div0 = element("div");
    			input = element("input");
    			label = element("label");
    			label.textContent = "Поиск по пересечению с объектом";
    			t2 = space();
    			if (if_block) if_block.c();
    			attr(input, "type", "checkbox");
    			attr(input, "name", "checkboxG4");
    			attr(input, "id", "checkboxG4");
    			attr(input, "class", "css-checkbox2");
    			attr(input, "title", "Нарисовать или выбрать объект по правой кнопке на вершине");
    			attr(label, "for", "checkboxG4");
    			attr(label, "class", "css-label2 radGroup1");
    			attr(div0, "class", "checkbox");
    			attr(div1, "class", "row");
    			dispose = listen(input, "change", ctx.createDrawing);
    		},
    		m(target, anchor) {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(target, anchor);
    			}

    			insert(target, t0, anchor);
    			insert(target, div1, anchor);
    			append(div1, div0);
    			append(div0, input);
    			ctx.input_binding(input);
    			append(div0, label);
    			append(div0, t2);
    			if (if_block) if_block.m(div0, null);
    		},
    		p(changed, ctx) {
    			if (changed.currLayer || changed.Object || changed.clearData) {
    				each_value = Object.keys(ctx.currLayer.filters);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(changed, child_ctx);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(t0.parentNode, t0);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (ctx.currDrawingObj) {
    				if (if_block) {
    					if_block.p(changed, ctx);
    				} else {
    					if_block = create_if_block_1(ctx);
    					if_block.c();
    					if_block.m(div0, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		d(detaching) {
    			destroy_each(each_blocks, detaching);
    			if (detaching) detach(t0);
    			if (detaching) detach(div1);
    			ctx.input_binding(null);
    			if (if_block) if_block.d();
    			dispose();
    		}
    	};
    }

    // (239:2) {#if currLayer.filters[field].datalist}
    function create_if_block_2(ctx) {
    	let datalist;
    	let datalist_id_value;
    	let each_value_1 = ctx.currLayer.filters[ctx.field].datalist;
    	let each_blocks = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
    	}

    	return {
    		c() {
    			datalist = element("datalist");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr(datalist, "id", datalist_id_value = ctx.field);
    		},
    		m(target, anchor) {
    			insert(target, datalist, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(datalist, null);
    			}
    		},
    		p(changed, ctx) {
    			if (changed.currLayer || changed.Object) {
    				each_value_1 = ctx.currLayer.filters[ctx.field].datalist;
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1(ctx, each_value_1, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(changed, child_ctx);
    					} else {
    						each_blocks[i] = create_each_block_1(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(datalist, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_1.length;
    			}

    			if (changed.currLayer && datalist_id_value !== (datalist_id_value = ctx.field)) {
    				attr(datalist, "id", datalist_id_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(datalist);
    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    // (241:4) {#each currLayer.filters[field].datalist as pt}
    function create_each_block_1(ctx) {
    	let option;
    	let option_value_value;

    	return {
    		c() {
    			option = element("option");
    			option.__value = option_value_value = ctx.pt.value;
    			option.value = option.__value;
    		},
    		m(target, anchor) {
    			insert(target, option, anchor);
    		},
    		p(changed, ctx) {
    			if (changed.currLayer && option_value_value !== (option_value_value = ctx.pt.value)) {
    				option.__value = option_value_value;
    			}

    			option.value = option.__value;
    		},
    		d(detaching) {
    			if (detaching) detach(option);
    		}
    	};
    }

    // (234:1) {#each Object.keys(currLayer.filters) as field}
    function create_each_block(ctx) {
    	let div2;
    	let div0;
    	let t0_value = ctx.currLayer.filters[ctx.field].title + "";
    	let t0;
    	let t1;
    	let div1;
    	let input;
    	let input_name_value;
    	let input_list_value;
    	let t2;
    	let dispose;
    	let if_block = ctx.currLayer.filters[ctx.field].datalist && create_if_block_2(ctx);

    	return {
    		c() {
    			div2 = element("div");
    			div0 = element("div");
    			t0 = text(t0_value);
    			t1 = space();
    			div1 = element("div");
    			input = element("input");
    			t2 = space();
    			if (if_block) if_block.c();
    			attr(div0, "class", "title");
    			attr(input, "type", "text");
    			attr(input, "name", input_name_value = ctx.field);
    			attr(input, "list", input_list_value = ctx.field);
    			attr(div1, "class", "input");
    			attr(div2, "class", "row");
    			dispose = listen(input, "change", ctx.clearData);
    		},
    		m(target, anchor) {
    			insert(target, div2, anchor);
    			append(div2, div0);
    			append(div0, t0);
    			append(div2, t1);
    			append(div2, div1);
    			append(div1, input);
    			append(div1, t2);
    			if (if_block) if_block.m(div1, null);
    		},
    		p(changed, ctx) {
    			if (changed.currLayer && t0_value !== (t0_value = ctx.currLayer.filters[ctx.field].title + "")) set_data(t0, t0_value);

    			if (changed.currLayer && input_name_value !== (input_name_value = ctx.field)) {
    				attr(input, "name", input_name_value);
    			}

    			if (changed.currLayer && input_list_value !== (input_list_value = ctx.field)) {
    				attr(input, "list", input_list_value);
    			}

    			if (ctx.currLayer.filters[ctx.field].datalist) {
    				if (if_block) {
    					if_block.p(changed, ctx);
    				} else {
    					if_block = create_if_block_2(ctx);
    					if_block.c();
    					if_block.m(div1, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div2);
    			if (if_block) if_block.d();
    			dispose();
    		}
    	};
    }

    // (253:3) {#if currDrawingObj}
    function create_if_block_1(ctx) {
    	let span;
    	let t;

    	return {
    		c() {
    			span = element("span");
    			t = text(ctx.currDrawingObjArea);
    			attr(span, "class", "currDrawingObjArea");
    		},
    		m(target, anchor) {
    			insert(target, span, anchor);
    			append(span, t);
    		},
    		p(changed, ctx) {
    			if (changed.currDrawingObjArea) set_data(t, ctx.currDrawingObjArea);
    		},
    		d(detaching) {
    			if (detaching) detach(span);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let div4;
    	let div2;
    	let div0;
    	let t1;
    	let div1;
    	let select;
    	let option;
    	let t2;
    	let t3;
    	let div3;
    	let button0;
    	let t5;
    	let a;
    	let iframe_1;
    	let t6;
    	let button1;
    	let a_class_value;
    	let div3_class_value;
    	let dispose;
    	let each_value_2 = Object.keys(ctx.filterLayers);
    	let each_blocks = [];

    	for (let i = 0; i < each_value_2.length; i += 1) {
    		each_blocks[i] = create_each_block_2(get_each_context_2(ctx, each_value_2, i));
    	}

    	let if_block = ctx.currLayer && create_if_block(ctx);

    	return {
    		c() {
    			div4 = element("div");
    			div2 = element("div");
    			div0 = element("div");
    			div0.textContent = "Выбор слоя";
    			t1 = space();
    			div1 = element("div");
    			select = element("select");
    			option = element("option");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t2 = space();
    			if (if_block) if_block.c();
    			t3 = space();
    			div3 = element("div");
    			button0 = element("button");
    			button0.textContent = "Создать слой по фильтру";
    			t5 = space();
    			a = element("a");
    			iframe_1 = element("iframe");
    			t6 = space();
    			button1 = element("button");
    			button1.textContent = "Экспорт в Excel";
    			attr(div0, "class", "title");
    			option.__value = "";
    			option.value = option.__value;
    			attr(div1, "class", "input");
    			attr(div2, "class", "row hidden");
    			attr(button0, "class", "button");
    			attr(iframe_1, "name", "download");
    			attr(iframe_1, "title", "");
    			attr(iframe_1, "class", "hidden");
    			attr(button1, "class", "button");
    			attr(a, "href", "load");
    			attr(a, "download", "features.geojson");
    			attr(a, "target", "download");
    			attr(a, "onload", ctx.setHidden);
    			attr(a, "class", a_class_value = "exportHref " + (ctx.filteredLayerID ? "" : "hidden"));
    			attr(div3, "class", div3_class_value = "bottom " + (ctx.currLayer ? "" : "hidden"));
    			attr(div4, "class", "sidebar-opened");

    			dispose = [
    				listen(window, "focus", ctx.setHidden),
    				listen(select, "change", ctx.changeLayer),
    				listen(button0, "click", ctx.createFilterLayer),
    				listen(iframe_1, "focus", ctx.clearData),
    				listen(button1, "click", ctx.createExport)
    			];
    		},
    		m(target, anchor) {
    			insert(target, div4, anchor);
    			append(div4, div2);
    			append(div2, div0);
    			append(div2, t1);
    			append(div2, div1);
    			append(div1, select);
    			append(select, option);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(select, null);
    			}

    			ctx.div2_binding(div2);
    			append(div4, t2);
    			if (if_block) if_block.m(div4, null);
    			append(div4, t3);
    			append(div4, div3);
    			append(div3, button0);
    			append(div3, t5);
    			append(div3, a);
    			append(a, iframe_1);
    			ctx.iframe_1_binding(iframe_1);
    			append(a, t6);
    			append(a, button1);
    			ctx.div4_binding(div4);
    		},
    		p(changed, ctx) {
    			if (changed.filterLayers || changed.Object) {
    				each_value_2 = Object.keys(ctx.filterLayers);
    				let i;

    				for (i = 0; i < each_value_2.length; i += 1) {
    					const child_ctx = get_each_context_2(ctx, each_value_2, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(changed, child_ctx);
    					} else {
    						each_blocks[i] = create_each_block_2(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(select, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_2.length;
    			}

    			if (ctx.currLayer) {
    				if (if_block) {
    					if_block.p(changed, ctx);
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					if_block.m(div4, t3);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (changed.filteredLayerID && a_class_value !== (a_class_value = "exportHref " + (ctx.filteredLayerID ? "" : "hidden"))) {
    				attr(a, "class", a_class_value);
    			}

    			if (changed.currLayer && div3_class_value !== (div3_class_value = "bottom " + (ctx.currLayer ? "" : "hidden"))) {
    				attr(div3, "class", div3_class_value);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div4);
    			destroy_each(each_blocks, detaching);
    			ctx.div2_binding(null);
    			if (if_block) if_block.d();
    			ctx.iframe_1_binding(null);
    			ctx.div4_binding(null);
    			run_all(dispose);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let waitingIcon = null;
    	let content = null;
    	let filterLayers = {};

    	const getColumnStat = id => {
    		let layer = gmxMap$1.layersByID[id],
    			_gmx = layer._gmx,
    			props = layer.getGmxProperties(),
    			meta = props.MetaProperties,
    			promiseArr = [];

    		for (var k in meta) {
    			if (k !== "filter") {
    				if (k in _gmx.tileAttributeIndexes) {
    					promiseArr.push(Requests.getColumnStat({ id, column: k }).then(json => {
    						let res = json.res.Result;

    						if (res && res.unique) {
    							return {
    								field: json.queue.params.column,
    								datalist: res.unique
    							};
    						}

    						return null;
    					}));
    				} else {
    					console.warn("В слое:", id, " поле:", k, " не существует!");
    				}
    			}
    		}

    		return Promise.all(promiseArr);
    	};

    	let gmxMap$1 = null;

    	gmxMap.subscribe(value => {
    		gmxMap$1 = value;

    		gmxMap$1.layers.forEach(it => {
    			let props = it.getGmxProperties(),
    				id = props.name,
    				meta = props.MetaProperties,
    				_gmx = gmxMap$1.layersByID[id]._gmx,
    				out = {
    					Title: props.title,
    					Description: props.description,
    					Copyright: props.Copyright,
    					IsRasterCatalog: false,
    					TemporalLayer: false,
    					filters: {}
    				};

    			for (var k in meta) {
    				if (k === "filter" && meta.filter.Value === "true") {
    					out.id = id;
    					out.title = props.title;
    					out.attr = props.attributes.map(n => "\"" + n + "\" as \"" + n + "\"").join(", ");
    				} else {
    					if (k in _gmx.tileAttributeIndexes) {
    						out.filters[k] = { title: meta[k].Value };
    					} else {
    						console.warn("В слое:", id, " поле:", k, " не существует!");
    					}
    				}
    			}

    			if (out.id) {
    				$$invalidate("filterLayers", filterLayers[id] = out, filterLayers);
    			}
    		});
    	});

    	let currLayer = null;

    	const changeLayer = ev => {
    		let id = ev ? ev.target.selectedOptions[0].value : null,
    			_gmx = gmxMap$1.layersByID[id];

    		$$invalidate("currLayer", currLayer = null);
    		waitingIcon.classList.remove("hidden");

    		if (id) {
    			getColumnStat(id).then(arr => {
    				$$invalidate("currLayer", currLayer = filterLayers[id]);

    				arr.forEach(it => {
    					$$invalidate("currLayer", currLayer.filters[it.field].datalist = it.datalist, currLayer);
    				});

    				setHidden();
    			});
    		}
    	};

    	let drawingButton = null;
    	let currDrawingObj = null;
    	let currDrawingObjArea = null;

    	const privaz = (ev, dObj) => {
    		$$invalidate("currDrawingObj", currDrawingObj = dObj || ev.object);
    		$$invalidate("currDrawingObjArea", currDrawingObjArea = currDrawingObj.getSummary());
    		clearData();
    		$$invalidate("drawingButton", drawingButton.checked = true, drawingButton);
    	};

    	let map = null;

    	leafletMap.subscribe(value => {
    		map = value;

    		map.gmxDrawing.contextmenu.insertItem(
    			{
    				callback: privaz,
    				text: "Привязать к фильтру"
    			},
    			0,
    			"points"
    		);
    	});

    	let drawingChecked = false;

    	const createDrawing = ev => {
    		drawingChecked = ev.target.checked;
    		L.DomEvent.stopPropagation(ev);
    		let cont = map.getContainer(), button = ev.target.parentNode;

    		if (drawingChecked) {
    			cont.style.cursor = "pointer";

    			let drawingControl = map.gmxControlsManager.get("drawing"),
    				pIcon = drawingControl.getIconById("Polygon");

    			drawingControl.setActiveIcon(pIcon, true);
    			map.gmxDrawing.on("drawstop", privaz, this);
    			map.gmxDrawing.bringToFront();
    		} else {
    			$$invalidate("currDrawingObj", currDrawingObj = $$invalidate("currDrawingObjArea", currDrawingObjArea = null));
    			cont.style.cursor = "";
    			button.classList.remove("drawState");
    			map.gmxDrawing.off("drawstop", privaz, this);
    			map.gmxDrawing.create();
    		}
    	};

    	const setHidden = ev => {
    		waitingIcon.classList.add("hidden");
    	};

    	let filteredLayerID = "";

    	const clearData = () => {
    		$$invalidate("filteredLayerID", filteredLayerID = "");
    	};

    	let iframe = null;

    	const createExport = ev => {
    		Requests.downloadLayer(ev.target.parentNode, filteredLayerID);
    	};

    	const createFilterLayer = ev => {
    		let id = currLayer.id,
    			layer = gmxMap$1.layersByID[id],
    			props = layer.getGmxProperties(),
    			nodes = content.getElementsByTagName("input"),
    			pars = { SourceType: "Sql", srs: 3857 },
    			arr = [];

    		waitingIcon.classList.remove("hidden");

    		for (let i = 0, len = nodes.length; i < len; i++) {
    			let node = nodes[i], name = node.name, val = node.value;

    			if (val && node !== drawingButton) {
    				arr.push("\"" + node.name + "\" = '" + val + "'");
    			}
    		}

    		pars.Title = "Фильтр " + arr.join(", ") + " по слою \"" + props.title + "\"";
    		pars.styles = props.styles;
    		pars.Description = props.description || "";
    		pars.Copyright = props.Copyright || "";
    		let w = "", alen = arr.length;

    		if (currDrawingObj || alen) {
    			w = "WHERE ";

    			if (alen) {
    				w += "(" + arr.join(") AND (") + ")";
    			}

    			if (currDrawingObj) {
    				w += alen ? " AND" : "";
    				w += " intersects([geomixergeojson], GeometryFromGeoJson('" + JSON.stringify(currDrawingObj.toGeoJSON()) + "', 4326))";
    			}
    		}

    		pars.Sql = "select [geomixergeojson] as gmx_geometry, " + currLayer.attr + ", \"gmx_id\" as \"gmx_id\" from [" + id + "] " + w;

    		Requests.createFilterLayer(pars).then(res => {
    			setHidden();
    			$$invalidate("filteredLayerID", filteredLayerID = res.content.properties.LayerID);
    		});
    	};

    	function div2_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate("waitingIcon", waitingIcon = $$value);
    		});
    	}

    	function input_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate("drawingButton", drawingButton = $$value);
    		});
    	}

    	function iframe_1_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate("iframe", iframe = $$value);
    		});
    	}

    	function div4_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate("content", content = $$value);
    		});
    	}

    	return {
    		waitingIcon,
    		content,
    		filterLayers,
    		currLayer,
    		changeLayer,
    		drawingButton,
    		currDrawingObj,
    		currDrawingObjArea,
    		createDrawing,
    		setHidden,
    		filteredLayerID,
    		clearData,
    		iframe,
    		createExport,
    		createFilterLayer,
    		div2_binding,
    		input_binding,
    		iframe_1_binding,
    		div4_binding
    	};
    }

    class Filters extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, {});
    	}
    }

    /* src\App.svelte generated by Svelte v3.14.0 */

    function create_if_block$1(ctx) {
    	let updating_openSidebar;
    	let current;

    	function filters_openSidebar_binding(value) {
    		ctx.filters_openSidebar_binding.call(null, value);
    	}

    	let filters_props = {};

    	if (ctx.openSidebar !== void 0) {
    		filters_props.openSidebar = ctx.openSidebar;
    	}

    	const filters = new Filters({ props: filters_props });
    	binding_callbacks.push(() => bind(filters, "openSidebar", filters_openSidebar_binding));

    	return {
    		c() {
    			create_component(filters.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(filters, target, anchor);
    			current = true;
    		},
    		p(changed, ctx) {
    			const filters_changes = {};

    			if (!updating_openSidebar && changed.openSidebar) {
    				updating_openSidebar = true;
    				filters_changes.openSidebar = ctx.openSidebar;
    				add_flush_callback(() => updating_openSidebar = false);
    			}

    			filters.$set(filters_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(filters.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(filters.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(filters, detaching);
    		}
    	};
    }

    function create_fragment$1(ctx) {
    	let div;
    	let ul;
    	let li;
    	let a;
    	let t0;
    	let a_class_value;
    	let t1;
    	let current;
    	let dispose;
    	let if_block = ctx.tab === "filters" && create_if_block$1(ctx);

    	return {
    		c() {
    			div = element("div");
    			ul = element("ul");
    			li = element("li");
    			a = element("a");
    			t0 = text("Фильтры");
    			t1 = space();
    			if (if_block) if_block.c();
    			attr(a, "class", a_class_value = "nav-link " + (ctx.tab === "filters" ? "active" : "-"));
    			attr(a, "href", "#filters");
    			attr(li, "class", "nav-item");
    			attr(ul, "class", "nav nav-tabs");
    			attr(div, "class", "domrf-plugin-container");
    			dispose = listen(a, "click", ctx.toggleSidebar);
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, ul);
    			append(ul, li);
    			append(li, a);
    			append(a, t0);
    			append(div, t1);
    			if (if_block) if_block.m(div, null);
    			current = true;
    		},
    		p(changed, ctx) {
    			if (!current || changed.tab && a_class_value !== (a_class_value = "nav-link " + (ctx.tab === "filters" ? "active" : "-"))) {
    				attr(a, "class", a_class_value);
    			}

    			if (ctx.tab === "filters") {
    				if (if_block) {
    					if_block.p(changed, ctx);
    					transition_in(if_block, 1);
    				} else {
    					if_block = create_if_block$1(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(div, null);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if (if_block) if_block.d();
    			dispose();
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { tab = "filters" } = $$props;
    	leafletMap.update(n => nsGmx.leafletMap);
    	gmxMap.update(n => nsGmx.gmxMap);

    	let toggleSidebar = ev => {
    		let classList = ev.target.classList, className = "rotate180";

    		if (classList.contains(className)) {
    			classList.remove(className);
    		} else {
    			classList.add(className);
    		}
    	};

    	let openSidebar = nm => {
    	};

    	function filters_openSidebar_binding(value) {
    		openSidebar = value;
    		$$invalidate("openSidebar", openSidebar);
    	}

    	$$self.$set = $$props => {
    		if ("tab" in $$props) $$invalidate("tab", tab = $$props.tab);
    	};

    	return {
    		tab,
    		toggleSidebar,
    		openSidebar,
    		filters_openSidebar_binding
    	};
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, { tab: 0 });
    	}
    }

    var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

    function unwrapExports (x) {
    	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
    }

    function createCommonjsModule(fn, module) {
    	return module = { exports: {} }, fn(module, module.exports), module.exports;
    }

    var oidcClient_min = createCommonjsModule(function (module, exports) {
    !function t(e,r){module.exports=r();}(commonjsGlobal,function(){return function(t){var e={};function r(n){if(e[n])return e[n].exports;var i=e[n]={i:n,l:!1,exports:{}};return t[n].call(i.exports,i,i.exports,r),i.l=!0,i.exports}return r.m=t,r.c=e,r.d=function(t,e,n){r.o(t,e)||Object.defineProperty(t,e,{enumerable:!0,get:n});},r.r=function(t){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(t,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(t,"__esModule",{value:!0});},r.t=function(t,e){if(1&e&&(t=r(t)),8&e)return t;if(4&e&&"object"==typeof t&&t&&t.__esModule)return t;var n=Object.create(null);if(r.r(n),Object.defineProperty(n,"default",{enumerable:!0,value:t}),2&e&&"string"!=typeof t)for(var i in t)r.d(n,i,function(e){return t[e]}.bind(null,i));return n},r.n=function(t){var e=t&&t.__esModule?function e(){return t.default}:function e(){return t};return r.d(e,"a",e),e},r.o=function(t,e){return Object.prototype.hasOwnProperty.call(t,e)},r.p="",r(r.s=22)}([function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0});var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}();var i={debug:function t(){},info:function t(){},warn:function t(){},error:function t(){}},o=void 0,s=void 0;(e.Log=function(){function t(){!function e(t,r){if(!(t instanceof r))throw new TypeError("Cannot call a class as a function")}(this,t);}return t.reset=function t(){s=3,o=i;},t.debug=function t(){if(s>=4){for(var e=arguments.length,r=Array(e),n=0;n<e;n++)r[n]=arguments[n];o.debug.apply(o,Array.from(r));}},t.info=function t(){if(s>=3){for(var e=arguments.length,r=Array(e),n=0;n<e;n++)r[n]=arguments[n];o.info.apply(o,Array.from(r));}},t.warn=function t(){if(s>=2){for(var e=arguments.length,r=Array(e),n=0;n<e;n++)r[n]=arguments[n];o.warn.apply(o,Array.from(r));}},t.error=function t(){if(s>=1){for(var e=arguments.length,r=Array(e),n=0;n<e;n++)r[n]=arguments[n];o.error.apply(o,Array.from(r));}},n(t,null,[{key:"NONE",get:function t(){return 0}},{key:"ERROR",get:function t(){return 1}},{key:"WARN",get:function t(){return 2}},{key:"INFO",get:function t(){return 3}},{key:"DEBUG",get:function t(){return 4}},{key:"level",get:function t(){return s},set:function t(e){if(!(0<=e&&e<=4))throw new Error("Invalid log level");s=e;}},{key:"logger",get:function t(){return o},set:function t(e){if(!e.debug&&e.info&&(e.debug=e.info),!(e.debug&&e.info&&e.warn&&e.error))throw new Error("Invalid logger");o=e;}}]),t}()).reset();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0});var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}();var i={setInterval:function(t){function e(e,r){return t.apply(this,arguments)}return e.toString=function(){return t.toString()},e}(function(t,e){return setInterval(t,e)}),clearInterval:function(t){function e(e){return t.apply(this,arguments)}return e.toString=function(){return t.toString()},e}(function(t){return clearInterval(t)})},o=!1,s=null;e.Global=function(){function t(){!function e(t,r){if(!(t instanceof r))throw new TypeError("Cannot call a class as a function")}(this,t);}return t._testing=function t(){o=!0;},t.setXMLHttpRequest=function t(e){s=e;},n(t,null,[{key:"location",get:function t(){if(!o)return location}},{key:"localStorage",get:function t(){if(!o&&"undefined"!=typeof window)return localStorage}},{key:"sessionStorage",get:function t(){if(!o&&"undefined"!=typeof window)return sessionStorage}},{key:"XMLHttpRequest",get:function t(){if(!o&&"undefined"!=typeof window)return s||XMLHttpRequest}},{key:"timer",get:function t(){if(!o)return i}}]),t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.MetadataService=void 0;var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),i=r(0),o=r(7);e.MetadataService=function(){function t(e){var r=arguments.length>1&&void 0!==arguments[1]?arguments[1]:o.JsonService;if(function n(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),!e)throw i.Log.error("MetadataService: No settings passed to MetadataService"),new Error("settings");this._settings=e,this._jsonService=new r(["application/jwk-set+json"]);}return t.prototype.getMetadata=function t(){var e=this;return this._settings.metadata?(i.Log.debug("MetadataService.getMetadata: Returning metadata from settings"),Promise.resolve(this._settings.metadata)):this.metadataUrl?(i.Log.debug("MetadataService.getMetadata: getting metadata from",this.metadataUrl),this._jsonService.getJson(this.metadataUrl).then(function(t){return i.Log.debug("MetadataService.getMetadata: json received"),e._settings.metadata=t,t})):(i.Log.error("MetadataService.getMetadata: No authority or metadataUrl configured on settings"),Promise.reject(new Error("No authority or metadataUrl configured on settings")))},t.prototype.getIssuer=function t(){return this._getMetadataProperty("issuer")},t.prototype.getAuthorizationEndpoint=function t(){return this._getMetadataProperty("authorization_endpoint")},t.prototype.getUserInfoEndpoint=function t(){return this._getMetadataProperty("userinfo_endpoint")},t.prototype.getTokenEndpoint=function t(){var e=!(arguments.length>0&&void 0!==arguments[0])||arguments[0];return this._getMetadataProperty("token_endpoint",e)},t.prototype.getCheckSessionIframe=function t(){return this._getMetadataProperty("check_session_iframe",!0)},t.prototype.getEndSessionEndpoint=function t(){return this._getMetadataProperty("end_session_endpoint",!0)},t.prototype.getRevocationEndpoint=function t(){return this._getMetadataProperty("revocation_endpoint",!0)},t.prototype.getKeysEndpoint=function t(){return this._getMetadataProperty("jwks_uri",!0)},t.prototype._getMetadataProperty=function t(e){var r=arguments.length>1&&void 0!==arguments[1]&&arguments[1];return i.Log.debug("MetadataService.getMetadataProperty for: "+e),this.getMetadata().then(function(t){if(i.Log.debug("MetadataService.getMetadataProperty: metadata recieved"),void 0===t[e]){if(!0===r)return void i.Log.warn("MetadataService.getMetadataProperty: Metadata does not contain optional property "+e);throw i.Log.error("MetadataService.getMetadataProperty: Metadata does not contain property "+e),new Error("Metadata does not contain property "+e)}return t[e]})},t.prototype.getSigningKeys=function t(){var e=this;return this._settings.signingKeys?(i.Log.debug("MetadataService.getSigningKeys: Returning signingKeys from settings"),Promise.resolve(this._settings.signingKeys)):this._getMetadataProperty("jwks_uri").then(function(t){return i.Log.debug("MetadataService.getSigningKeys: jwks_uri received",t),e._jsonService.getJson(t).then(function(t){if(i.Log.debug("MetadataService.getSigningKeys: key set received",t),!t.keys)throw i.Log.error("MetadataService.getSigningKeys: Missing keys on keyset"),new Error("Missing keys on keyset");return e._settings.signingKeys=t.keys,e._settings.signingKeys})})},n(t,[{key:"metadataUrl",get:function t(){return this._metadataUrl||(this._settings.metadataUrl?this._metadataUrl=this._settings.metadataUrl:(this._metadataUrl=this._settings.authority,this._metadataUrl&&this._metadataUrl.indexOf(".well-known/openid-configuration")<0&&("/"!==this._metadataUrl[this._metadataUrl.length-1]&&(this._metadataUrl+="/"),this._metadataUrl+=".well-known/openid-configuration"))),this._metadataUrl}}]),t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.UrlUtility=void 0;var n=r(0),i=r(1);e.UrlUtility=function(){function t(){!function e(t,r){if(!(t instanceof r))throw new TypeError("Cannot call a class as a function")}(this,t);}return t.addQueryParam=function t(e,r,n){return e.indexOf("?")<0&&(e+="?"),"?"!==e[e.length-1]&&(e+="&"),e+=encodeURIComponent(r),e+="=",e+=encodeURIComponent(n)},t.parseUrlFragment=function t(e){var r=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"#",o=arguments.length>2&&void 0!==arguments[2]?arguments[2]:i.Global;"string"!=typeof e&&(e=o.location.href);var s=e.lastIndexOf(r);s>=0&&(e=e.substr(s+1)),"?"===r&&(s=e.indexOf("#"))>=0&&(e=e.substr(0,s));for(var a,u={},c=/([^&=]+)=([^&]*)/g,h=0;a=c.exec(e);)if(u[decodeURIComponent(a[1])]=decodeURIComponent(a[2]),h++>50)return n.Log.error("UrlUtility.parseUrlFragment: response exceeded expected number of parameters",e),{error:"Response exceeded expected number of parameters"};for(var l in u)return u;return {}},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.JoseUtil=void 0;var n=r(25),i=function o(t){return t&&t.__esModule?t:{default:t}}(r(32));e.JoseUtil=(0, i.default)({jws:n.jws,KeyUtil:n.KeyUtil,X509:n.X509,crypto:n.crypto,hextob64u:n.hextob64u,b64tohex:n.b64tohex,AllowedSigningAlgs:n.AllowedSigningAlgs});},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.OidcClientSettings=void 0;var n="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},i=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),o=r(0),s=r(6),a=r(23),u=r(2);var c="id_token",h="openid",l=900,f=300;e.OidcClientSettings=function(){function t(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},r=e.authority,i=e.metadataUrl,o=e.metadata,d=e.signingKeys,p=e.client_id,g=e.client_secret,v=e.response_type,y=void 0===v?c:v,m=e.scope,_=void 0===m?h:m,S=e.redirect_uri,F=e.post_logout_redirect_uri,b=e.prompt,w=e.display,E=e.max_age,x=e.ui_locales,k=e.acr_values,A=e.resource,P=e.response_mode,C=e.filterProtocolClaims,T=void 0===C||C,R=e.loadUserInfo,I=void 0===R||R,D=e.staleStateAge,L=void 0===D?l:D,U=e.clockSkew,B=void 0===U?f:U,N=e.userInfoJwtIssuer,O=void 0===N?"OP":N,j=e.stateStore,H=void 0===j?new s.WebStorageStateStore:j,M=e.ResponseValidatorCtor,K=void 0===M?a.ResponseValidator:M,V=e.MetadataServiceCtor,q=void 0===V?u.MetadataService:V,J=e.extraQueryParams,W=void 0===J?{}:J;!function z(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this._authority=r,this._metadataUrl=i,this._metadata=o,this._signingKeys=d,this._client_id=p,this._client_secret=g,this._response_type=y,this._scope=_,this._redirect_uri=S,this._post_logout_redirect_uri=F,this._prompt=b,this._display=w,this._max_age=E,this._ui_locales=x,this._acr_values=k,this._resource=A,this._response_mode=P,this._filterProtocolClaims=!!T,this._loadUserInfo=!!I,this._staleStateAge=L,this._clockSkew=B,this._userInfoJwtIssuer=O,this._stateStore=H,this._validator=new K(this),this._metadataService=new q(this),this._extraQueryParams="object"===(void 0===W?"undefined":n(W))?W:{};}return i(t,[{key:"client_id",get:function t(){return this._client_id},set:function t(e){if(this._client_id)throw o.Log.error("OidcClientSettings.set_client_id: client_id has already been assigned."),new Error("client_id has already been assigned.");this._client_id=e;}},{key:"client_secret",get:function t(){return this._client_secret}},{key:"response_type",get:function t(){return this._response_type}},{key:"scope",get:function t(){return this._scope}},{key:"redirect_uri",get:function t(){return this._redirect_uri}},{key:"post_logout_redirect_uri",get:function t(){return this._post_logout_redirect_uri}},{key:"prompt",get:function t(){return this._prompt}},{key:"display",get:function t(){return this._display}},{key:"max_age",get:function t(){return this._max_age}},{key:"ui_locales",get:function t(){return this._ui_locales}},{key:"acr_values",get:function t(){return this._acr_values}},{key:"resource",get:function t(){return this._resource}},{key:"response_mode",get:function t(){return this._response_mode}},{key:"authority",get:function t(){return this._authority},set:function t(e){if(this._authority)throw o.Log.error("OidcClientSettings.set_authority: authority has already been assigned."),new Error("authority has already been assigned.");this._authority=e;}},{key:"metadataUrl",get:function t(){return this._metadataUrl||(this._metadataUrl=this.authority,this._metadataUrl&&this._metadataUrl.indexOf(".well-known/openid-configuration")<0&&("/"!==this._metadataUrl[this._metadataUrl.length-1]&&(this._metadataUrl+="/"),this._metadataUrl+=".well-known/openid-configuration")),this._metadataUrl}},{key:"metadata",get:function t(){return this._metadata},set:function t(e){this._metadata=e;}},{key:"signingKeys",get:function t(){return this._signingKeys},set:function t(e){this._signingKeys=e;}},{key:"filterProtocolClaims",get:function t(){return this._filterProtocolClaims}},{key:"loadUserInfo",get:function t(){return this._loadUserInfo}},{key:"staleStateAge",get:function t(){return this._staleStateAge}},{key:"clockSkew",get:function t(){return this._clockSkew}},{key:"userInfoJwtIssuer",get:function t(){return this._userInfoJwtIssuer}},{key:"stateStore",get:function t(){return this._stateStore}},{key:"validator",get:function t(){return this._validator}},{key:"metadataService",get:function t(){return this._metadataService}},{key:"extraQueryParams",get:function t(){return this._extraQueryParams},set:function t(e){"object"===(void 0===e?"undefined":n(e))?this._extraQueryParams=e:this._extraQueryParams={};}}]),t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.WebStorageStateStore=void 0;var n=r(0),i=r(1);e.WebStorageStateStore=function(){function t(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},r=e.prefix,n=void 0===r?"oidc.":r,o=e.store,s=void 0===o?i.Global.localStorage:o;!function a(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this._store=s,this._prefix=n;}return t.prototype.set=function t(e,r){return n.Log.debug("WebStorageStateStore.set",e),e=this._prefix+e,this._store.setItem(e,r),Promise.resolve()},t.prototype.get=function t(e){n.Log.debug("WebStorageStateStore.get",e),e=this._prefix+e;var r=this._store.getItem(e);return Promise.resolve(r)},t.prototype.remove=function t(e){n.Log.debug("WebStorageStateStore.remove",e),e=this._prefix+e;var r=this._store.getItem(e);return this._store.removeItem(e),Promise.resolve(r)},t.prototype.getAllKeys=function t(){n.Log.debug("WebStorageStateStore.getAllKeys");for(var e=[],r=0;r<this._store.length;r++){var i=this._store.key(r);0===i.indexOf(this._prefix)&&e.push(i.substr(this._prefix.length));}return Promise.resolve(e)},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.JsonService=void 0;var n=r(0),i=r(1);e.JsonService=function(){function t(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:null,r=arguments.length>1&&void 0!==arguments[1]?arguments[1]:i.Global.XMLHttpRequest,n=arguments.length>2&&void 0!==arguments[2]?arguments[2]:null;!function o(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),e&&Array.isArray(e)?this._contentTypes=e.slice():this._contentTypes=[],this._contentTypes.push("application/json"),n&&this._contentTypes.push("application/jwt"),this._XMLHttpRequest=r,this._jwtHandler=n;}return t.prototype.getJson=function t(e,r){var i=this;if(!e)throw n.Log.error("JsonService.getJson: No url passed"),new Error("url");return n.Log.debug("JsonService.getJson, url: ",e),new Promise(function(t,o){var s=new i._XMLHttpRequest;s.open("GET",e);var a=i._contentTypes,u=i._jwtHandler;s.onload=function(){if(n.Log.debug("JsonService.getJson: HTTP response received, status",s.status),200===s.status){var r=s.getResponseHeader("Content-Type");if(r){var i=a.find(function(t){if(r.startsWith(t))return !0});if("application/jwt"==i)return void u(s).then(t,o);if(i)try{return void t(JSON.parse(s.responseText))}catch(t){return n.Log.error("JsonService.getJson: Error parsing JSON response",t.message),void o(t)}}o(Error("Invalid response Content-Type: "+r+", from URL: "+e));}else o(Error(s.statusText+" ("+s.status+")"));},s.onerror=function(){n.Log.error("JsonService.getJson: network error"),o(Error("Network Error"));},r&&(n.Log.debug("JsonService.getJson: token passed, setting Authorization header"),s.setRequestHeader("Authorization","Bearer "+r)),s.send();})},t.prototype.postForm=function t(e,r){var i=this;if(!e)throw n.Log.error("JsonService.postForm: No url passed"),new Error("url");return n.Log.debug("JsonService.postForm, url: ",e),new Promise(function(t,o){var s=new i._XMLHttpRequest;s.open("POST",e);var a=i._contentTypes;s.onload=function(){if(n.Log.debug("JsonService.postForm: HTTP response received, status",s.status),200!==s.status){if(400===s.status)if(i=s.getResponseHeader("Content-Type"))if(a.find(function(t){if(i.startsWith(t))return !0}))try{var r=JSON.parse(s.responseText);if(r&&r.error)return n.Log.error("JsonService.postForm: Error from server: ",r.error),void o(new Error(r.error))}catch(t){return n.Log.error("JsonService.postForm: Error parsing JSON response",t.message),void o(t)}o(Error(s.statusText+" ("+s.status+")"));}else{var i;if((i=s.getResponseHeader("Content-Type"))&&a.find(function(t){if(i.startsWith(t))return !0}))try{return void t(JSON.parse(s.responseText))}catch(t){return n.Log.error("JsonService.postForm: Error parsing JSON response",t.message),void o(t)}o(Error("Invalid response Content-Type: "+i+", from URL: "+e));}},s.onerror=function(){n.Log.error("JsonService.postForm: network error"),o(Error("Network Error"));};var u="";for(var c in r){var h=r[c];h&&(u.length>0&&(u+="&"),u+=encodeURIComponent(c),u+="=",u+=encodeURIComponent(h));}s.setRequestHeader("Content-Type","application/x-www-form-urlencoded"),s.send(u);})},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.State=void 0;var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),i=r(0),o=function s(t){return t&&t.__esModule?t:{default:t}}(r(14));e.State=function(){function t(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},r=e.id,n=e.data,i=e.created,s=e.request_type;!function a(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this._id=r||(0, o.default)(),this._data=n,this._created="number"==typeof i&&i>0?i:parseInt(Date.now()/1e3),this._request_type=s;}return t.prototype.toStorageString=function t(){return i.Log.debug("State.toStorageString"),JSON.stringify({id:this.id,data:this.data,created:this.created,request_type:this.request_type})},t.fromStorageString=function e(r){return i.Log.debug("State.fromStorageString"),new t(JSON.parse(r))},t.clearStaleState=function e(r,n){var o=Date.now()/1e3-n;return r.getAllKeys().then(function(e){i.Log.debug("State.clearStaleState: got keys",e);for(var n=[],s=function s(a){var c=e[a];u=r.get(c).then(function(e){var n=!1;if(e)try{var s=t.fromStorageString(e);i.Log.debug("State.clearStaleState: got item from key: ",c,s.created),s.created<=o&&(n=!0);}catch(t){i.Log.error("State.clearStaleState: Error parsing state for key",c,t.message),n=!0;}else i.Log.debug("State.clearStaleState: no item in storage for key: ",c),n=!0;if(n)return i.Log.debug("State.clearStaleState: removed item for key: ",c),r.remove(c)}),n.push(u);},a=0;a<e.length;a++){var u;s(a);}return i.Log.debug("State.clearStaleState: waiting on promise count:",n.length),Promise.all(n)})},n(t,[{key:"id",get:function t(){return this._id}},{key:"data",get:function t(){return this._data}},{key:"created",get:function t(){return this._created}},{key:"request_type",get:function t(){return this._request_type}}]),t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.OidcClient=void 0;var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),i=r(0),o=r(5),s=r(11),a=r(12),u=r(36),c=r(37),h=r(38),l=r(13),f=r(8);e.OidcClient=function(){function t(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};!function r(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),e instanceof o.OidcClientSettings?this._settings=e:this._settings=new o.OidcClientSettings(e);}return t.prototype.createSigninRequest=function t(){var e=this,r=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},n=r.response_type,o=r.scope,s=r.redirect_uri,u=r.data,c=r.state,h=r.prompt,l=r.display,f=r.max_age,d=r.ui_locales,p=r.id_token_hint,g=r.login_hint,v=r.acr_values,y=r.resource,m=r.request,_=r.request_uri,S=r.response_mode,F=r.extraQueryParams,b=r.extraTokenParams,w=r.request_type,E=r.skipUserInfo,x=arguments[1];i.Log.debug("OidcClient.createSigninRequest");var k=this._settings.client_id;n=n||this._settings.response_type,o=o||this._settings.scope,s=s||this._settings.redirect_uri,h=h||this._settings.prompt,l=l||this._settings.display,f=f||this._settings.max_age,d=d||this._settings.ui_locales,v=v||this._settings.acr_values,y=y||this._settings.resource,S=S||this._settings.response_mode,F=F||this._settings.extraQueryParams;var A=this._settings.authority;return a.SigninRequest.isCode(n)&&"code"!==n?Promise.reject(new Error("OpenID Connect hybrid flow is not supported")):this._metadataService.getAuthorizationEndpoint().then(function(t){i.Log.debug("OidcClient.createSigninRequest: Received authorization endpoint",t);var r=new a.SigninRequest({url:t,client_id:k,redirect_uri:s,response_type:n,scope:o,data:u||c,authority:A,prompt:h,display:l,max_age:f,ui_locales:d,id_token_hint:p,login_hint:g,acr_values:v,resource:y,request:m,request_uri:_,extraQueryParams:F,extraTokenParams:b,request_type:w,response_mode:S,client_secret:e._settings.client_secret,skipUserInfo:E}),P=r.state;return (x=x||e._stateStore).set(P.id,P.toStorageString()).then(function(){return r})})},t.prototype.readSigninResponseState=function t(e,r){var n=arguments.length>2&&void 0!==arguments[2]&&arguments[2];i.Log.debug("OidcClient.readSigninResponseState");var o="query"===this._settings.response_mode||!this._settings.response_mode&&a.SigninRequest.isCode(this._settings.response_type)?"?":"#",s=new u.SigninResponse(e,o);return s.state?(r=r||this._stateStore,(n?r.remove.bind(r):r.get.bind(r))(s.state).then(function(t){if(!t)throw i.Log.error("OidcClient.readSigninResponseState: No matching state found in storage"),new Error("No matching state found in storage");return {state:l.SigninState.fromStorageString(t),response:s}})):(i.Log.error("OidcClient.readSigninResponseState: No state in response"),Promise.reject(new Error("No state in response")))},t.prototype.processSigninResponse=function t(e,r){var n=this;return i.Log.debug("OidcClient.processSigninResponse"),this.readSigninResponseState(e,r,!0).then(function(t){var e=t.state,r=t.response;return i.Log.debug("OidcClient.processSigninResponse: Received state from storage; validating response"),n._validator.validateSigninResponse(e,r)})},t.prototype.createSignoutRequest=function t(){var e=this,r=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},n=r.id_token_hint,o=r.data,s=r.state,a=r.post_logout_redirect_uri,u=r.extraQueryParams,h=r.request_type,l=arguments[1];return i.Log.debug("OidcClient.createSignoutRequest"),a=a||this._settings.post_logout_redirect_uri,u=u||this._settings.extraQueryParams,this._metadataService.getEndSessionEndpoint().then(function(t){if(!t)throw i.Log.error("OidcClient.createSignoutRequest: No end session endpoint url returned"),new Error("no end session endpoint");i.Log.debug("OidcClient.createSignoutRequest: Received end session endpoint",t);var r=new c.SignoutRequest({url:t,id_token_hint:n,post_logout_redirect_uri:a,data:o||s,extraQueryParams:u,request_type:h}),f=r.state;return f&&(i.Log.debug("OidcClient.createSignoutRequest: Signout request has state to persist"),(l=l||e._stateStore).set(f.id,f.toStorageString())),r})},t.prototype.readSignoutResponseState=function t(e,r){var n=arguments.length>2&&void 0!==arguments[2]&&arguments[2];i.Log.debug("OidcClient.readSignoutResponseState");var o=new h.SignoutResponse(e);if(!o.state)return i.Log.debug("OidcClient.readSignoutResponseState: No state in response"),o.error?(i.Log.warn("OidcClient.readSignoutResponseState: Response was error: ",o.error),Promise.reject(new s.ErrorResponse(o))):Promise.resolve({undefined:void 0,response:o});var a=o.state;return r=r||this._stateStore,(n?r.remove.bind(r):r.get.bind(r))(a).then(function(t){if(!t)throw i.Log.error("OidcClient.readSignoutResponseState: No matching state found in storage"),new Error("No matching state found in storage");return {state:f.State.fromStorageString(t),response:o}})},t.prototype.processSignoutResponse=function t(e,r){var n=this;return i.Log.debug("OidcClient.processSignoutResponse"),this.readSignoutResponseState(e,r,!0).then(function(t){var e=t.state,r=t.response;return e?(i.Log.debug("OidcClient.processSignoutResponse: Received state from storage; validating response"),n._validator.validateSignoutResponse(e,r)):(i.Log.debug("OidcClient.processSignoutResponse: No state from storage; skipping validating response"),r)})},t.prototype.clearStaleState=function t(e){return i.Log.debug("OidcClient.clearStaleState"),e=e||this._stateStore,f.State.clearStaleState(e,this.settings.staleStateAge)},n(t,[{key:"_stateStore",get:function t(){return this.settings.stateStore}},{key:"_validator",get:function t(){return this.settings.validator}},{key:"_metadataService",get:function t(){return this.settings.metadataService}},{key:"settings",get:function t(){return this._settings}},{key:"metadataService",get:function t(){return this._metadataService}}]),t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.TokenClient=void 0;var n=r(7),i=r(2),o=r(0);e.TokenClient=function(){function t(e){var r=arguments.length>1&&void 0!==arguments[1]?arguments[1]:n.JsonService,s=arguments.length>2&&void 0!==arguments[2]?arguments[2]:i.MetadataService;if(function a(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),!e)throw o.Log.error("TokenClient.ctor: No settings passed"),new Error("settings");this._settings=e,this._jsonService=new r,this._metadataService=new s(this._settings);}return t.prototype.exchangeCode=function t(){var e=this,r=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};return (r=Object.assign({},r)).grant_type=r.grant_type||"authorization_code",r.client_id=r.client_id||this._settings.client_id,r.redirect_uri=r.redirect_uri||this._settings.redirect_uri,r.code?r.redirect_uri?r.code_verifier?r.client_id?this._metadataService.getTokenEndpoint(!1).then(function(t){return o.Log.debug("TokenClient.exchangeCode: Received token endpoint"),e._jsonService.postForm(t,r).then(function(t){return o.Log.debug("TokenClient.exchangeCode: response received"),t})}):(o.Log.error("TokenClient.exchangeCode: No client_id passed"),Promise.reject(new Error("A client_id is required"))):(o.Log.error("TokenClient.exchangeCode: No code_verifier passed"),Promise.reject(new Error("A code_verifier is required"))):(o.Log.error("TokenClient.exchangeCode: No redirect_uri passed"),Promise.reject(new Error("A redirect_uri is required"))):(o.Log.error("TokenClient.exchangeCode: No code passed"),Promise.reject(new Error("A code is required")))},t.prototype.exchangeRefreshToken=function t(){var e=this,r=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};return (r=Object.assign({},r)).grant_type=r.grant_type||"refresh_token",r.client_id=r.client_id||this._settings.client_id,r.client_secret=r.client_secret||this._settings.client_secret,r.refresh_token?r.client_id?this._metadataService.getTokenEndpoint(!1).then(function(t){return o.Log.debug("TokenClient.exchangeRefreshToken: Received token endpoint"),e._jsonService.postForm(t,r).then(function(t){return o.Log.debug("TokenClient.exchangeRefreshToken: response received"),t})}):(o.Log.error("TokenClient.exchangeRefreshToken: No client_id passed"),Promise.reject(new Error("A client_id is required"))):(o.Log.error("TokenClient.exchangeRefreshToken: No refresh_token passed"),Promise.reject(new Error("A refresh_token is required")))},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.ErrorResponse=void 0;var n=r(0);e.ErrorResponse=function(t){function e(){var r=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},i=r.error,o=r.error_description,s=r.error_uri,a=r.state;if(function u(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,e),!i)throw n.Log.error("No error passed to ErrorResponse"),new Error("error");var c=function h(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return !e||"object"!=typeof e&&"function"!=typeof e?t:e}(this,t.call(this,o||i));return c.name="ErrorResponse",c.error=i,c.error_description=o,c.error_uri=s,c.state=a,c}return function r(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e);}(e,t),e}(Error);},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.SigninRequest=void 0;var n=r(0),i=r(3),o=r(13);e.SigninRequest=function(){function t(e){var r=e.url,s=e.client_id,a=e.redirect_uri,u=e.response_type,c=e.scope,h=e.authority,l=e.data,f=e.prompt,d=e.display,p=e.max_age,g=e.ui_locales,v=e.id_token_hint,y=e.login_hint,m=e.acr_values,_=e.resource,S=e.response_mode,F=e.request,b=e.request_uri,w=e.extraQueryParams,E=e.request_type,x=e.client_secret,k=e.extraTokenParams,A=e.skipUserInfo;if(function P(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),!r)throw n.Log.error("SigninRequest.ctor: No url passed"),new Error("url");if(!s)throw n.Log.error("SigninRequest.ctor: No client_id passed"),new Error("client_id");if(!a)throw n.Log.error("SigninRequest.ctor: No redirect_uri passed"),new Error("redirect_uri");if(!u)throw n.Log.error("SigninRequest.ctor: No response_type passed"),new Error("response_type");if(!c)throw n.Log.error("SigninRequest.ctor: No scope passed"),new Error("scope");if(!h)throw n.Log.error("SigninRequest.ctor: No authority passed"),new Error("authority");var C=t.isOidc(u),T=t.isCode(u);S||(S=t.isCode(u)?"query":null),this.state=new o.SigninState({nonce:C,data:l,client_id:s,authority:h,redirect_uri:a,code_verifier:T,request_type:E,response_mode:S,client_secret:x,scope:c,extraTokenParams:k,skipUserInfo:A}),r=i.UrlUtility.addQueryParam(r,"client_id",s),r=i.UrlUtility.addQueryParam(r,"redirect_uri",a),r=i.UrlUtility.addQueryParam(r,"response_type",u),r=i.UrlUtility.addQueryParam(r,"scope",c),r=i.UrlUtility.addQueryParam(r,"state",this.state.id),C&&(r=i.UrlUtility.addQueryParam(r,"nonce",this.state.nonce)),T&&(r=i.UrlUtility.addQueryParam(r,"code_challenge",this.state.code_challenge),r=i.UrlUtility.addQueryParam(r,"code_challenge_method","S256"));var R={prompt:f,display:d,max_age:p,ui_locales:g,id_token_hint:v,login_hint:y,acr_values:m,resource:_,request:F,request_uri:b,response_mode:S};for(var I in R)R[I]&&(r=i.UrlUtility.addQueryParam(r,I,R[I]));for(var D in w)r=i.UrlUtility.addQueryParam(r,D,w[D]);this.url=r;}return t.isOidc=function t(e){return !!e.split(/\s+/g).filter(function(t){return "id_token"===t})[0]},t.isOAuth=function t(e){return !!e.split(/\s+/g).filter(function(t){return "token"===t})[0]},t.isCode=function t(e){return !!e.split(/\s+/g).filter(function(t){return "code"===t})[0]},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.SigninState=void 0;var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),i=r(0),o=r(8),s=r(4),a=function u(t){return t&&t.__esModule?t:{default:t}}(r(14));e.SigninState=function(t){function e(){var r=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},n=r.nonce,i=r.authority,o=r.client_id,u=r.redirect_uri,c=r.code_verifier,h=r.response_mode,l=r.client_secret,f=r.scope,d=r.extraTokenParams,p=r.skipUserInfo;!function g(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,e);var v=function y(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return !e||"object"!=typeof e&&"function"!=typeof e?t:e}(this,t.call(this,arguments[0]));if(!0===n?v._nonce=(0, a.default)():n&&(v._nonce=n),!0===c?v._code_verifier=(0, a.default)()+(0, a.default)()+(0, a.default)():c&&(v._code_verifier=c),v.code_verifier){var m=s.JoseUtil.hashString(v.code_verifier,"SHA256");v._code_challenge=s.JoseUtil.hexToBase64Url(m);}return v._redirect_uri=u,v._authority=i,v._client_id=o,v._response_mode=h,v._client_secret=l,v._scope=f,v._extraTokenParams=d,v._skipUserInfo=p,v}return function r(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e);}(e,t),e.prototype.toStorageString=function t(){return i.Log.debug("SigninState.toStorageString"),JSON.stringify({id:this.id,data:this.data,created:this.created,request_type:this.request_type,nonce:this.nonce,code_verifier:this.code_verifier,redirect_uri:this.redirect_uri,authority:this.authority,client_id:this.client_id,response_mode:this.response_mode,client_secret:this.client_secret,scope:this.scope,extraTokenParams:this.extraTokenParams,skipUserInfo:this.skipUserInfo})},e.fromStorageString=function t(r){return i.Log.debug("SigninState.fromStorageString"),new e(JSON.parse(r))},n(e,[{key:"nonce",get:function t(){return this._nonce}},{key:"authority",get:function t(){return this._authority}},{key:"client_id",get:function t(){return this._client_id}},{key:"redirect_uri",get:function t(){return this._redirect_uri}},{key:"code_verifier",get:function t(){return this._code_verifier}},{key:"code_challenge",get:function t(){return this._code_challenge}},{key:"response_mode",get:function t(){return this._response_mode}},{key:"client_secret",get:function t(){return this._client_secret}},{key:"scope",get:function t(){return this._scope}},{key:"extraTokenParams",get:function t(){return this._extraTokenParams}},{key:"skipUserInfo",get:function t(){return this._skipUserInfo}}]),e}(o.State);},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.default=function n(){return (0, i.default)().replace(/-/g,"")};var i=function o(t){return t&&t.__esModule?t:{default:t}}(r(33));t.exports=e.default;},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.User=void 0;var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),i=r(0);e.User=function(){function t(e){var r=e.id_token,n=e.session_state,i=e.access_token,o=e.refresh_token,s=e.token_type,a=e.scope,u=e.profile,c=e.expires_at,h=e.state;!function l(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.id_token=r,this.session_state=n,this.access_token=i,this.refresh_token=o,this.token_type=s,this.scope=a,this.profile=u,this.expires_at=c,this.state=h;}return t.prototype.toStorageString=function t(){return i.Log.debug("User.toStorageString"),JSON.stringify({id_token:this.id_token,session_state:this.session_state,access_token:this.access_token,refresh_token:this.refresh_token,token_type:this.token_type,scope:this.scope,profile:this.profile,expires_at:this.expires_at})},t.fromStorageString=function e(r){return i.Log.debug("User.fromStorageString"),new t(JSON.parse(r))},n(t,[{key:"expires_in",get:function t(){if(this.expires_at){var e=parseInt(Date.now()/1e3);return this.expires_at-e}},set:function t(e){var r=parseInt(e);if("number"==typeof r&&r>0){var n=parseInt(Date.now()/1e3);this.expires_at=n+r;}}},{key:"expired",get:function t(){var e=this.expires_in;if(void 0!==e)return e<=0}},{key:"scopes",get:function t(){return (this.scope||"").split(" ")}}]),t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.AccessTokenEvents=void 0;var n=r(0),i=r(48);var o=60;e.AccessTokenEvents=function(){function t(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},r=e.accessTokenExpiringNotificationTime,n=void 0===r?o:r,s=e.accessTokenExpiringTimer,a=void 0===s?new i.Timer("Access token expiring"):s,u=e.accessTokenExpiredTimer,c=void 0===u?new i.Timer("Access token expired"):u;!function h(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this._accessTokenExpiringNotificationTime=n,this._accessTokenExpiring=a,this._accessTokenExpired=c;}return t.prototype.load=function t(e){if(e.access_token&&void 0!==e.expires_in){var r=e.expires_in;if(n.Log.debug("AccessTokenEvents.load: access token present, remaining duration:",r),r>0){var i=r-this._accessTokenExpiringNotificationTime;i<=0&&(i=1),n.Log.debug("AccessTokenEvents.load: registering expiring timer in:",i),this._accessTokenExpiring.init(i);}else n.Log.debug("AccessTokenEvents.load: canceling existing expiring timer becase we're past expiration."),this._accessTokenExpiring.cancel();var o=r+1;n.Log.debug("AccessTokenEvents.load: registering expired timer in:",o),this._accessTokenExpired.init(o);}else this._accessTokenExpiring.cancel(),this._accessTokenExpired.cancel();},t.prototype.unload=function t(){n.Log.debug("AccessTokenEvents.unload: canceling existing access token timers"),this._accessTokenExpiring.cancel(),this._accessTokenExpired.cancel();},t.prototype.addAccessTokenExpiring=function t(e){this._accessTokenExpiring.addHandler(e);},t.prototype.removeAccessTokenExpiring=function t(e){this._accessTokenExpiring.removeHandler(e);},t.prototype.addAccessTokenExpired=function t(e){this._accessTokenExpired.addHandler(e);},t.prototype.removeAccessTokenExpired=function t(e){this._accessTokenExpired.removeHandler(e);},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.Event=void 0;var n=r(0);e.Event=function(){function t(e){!function r(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this._name=e,this._callbacks=[];}return t.prototype.addHandler=function t(e){this._callbacks.push(e);},t.prototype.removeHandler=function t(e){var r=this._callbacks.findIndex(function(t){return t===e});r>=0&&this._callbacks.splice(r,1);},t.prototype.raise=function t(){n.Log.debug("Event: Raising event: "+this._name);for(var e=0;e<this._callbacks.length;e++){var r;(r=this._callbacks)[e].apply(r,arguments);}},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.SessionMonitor=void 0;var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),i=r(0),o=r(19);e.SessionMonitor=function(){function t(e){var r=this,n=arguments.length>1&&void 0!==arguments[1]?arguments[1]:o.CheckSessionIFrame;if(function s(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),!e)throw i.Log.error("SessionMonitor.ctor: No user manager passed to SessionMonitor"),new Error("userManager");this._userManager=e,this._CheckSessionIFrameCtor=n,this._userManager.events.addUserLoaded(this._start.bind(this)),this._userManager.events.addUserUnloaded(this._stop.bind(this)),this._userManager.getUser().then(function(t){t&&r._start(t);}).catch(function(t){i.Log.error("SessionMonitor ctor: error from getUser:",t.message);});}return t.prototype._start=function t(e){var r=this,n=e.session_state;n&&(this._sub=e.profile.sub,this._sid=e.profile.sid,i.Log.debug("SessionMonitor._start: session_state:",n,", sub:",this._sub),this._checkSessionIFrame?this._checkSessionIFrame.start(n):this._metadataService.getCheckSessionIframe().then(function(t){if(t){i.Log.debug("SessionMonitor._start: Initializing check session iframe");var e=r._client_id,o=r._checkSessionInterval,s=r._stopCheckSessionOnError;r._checkSessionIFrame=new r._CheckSessionIFrameCtor(r._callback.bind(r),e,t,o,s),r._checkSessionIFrame.load().then(function(){r._checkSessionIFrame.start(n);});}else i.Log.warn("SessionMonitor._start: No check session iframe found in the metadata");}).catch(function(t){i.Log.error("SessionMonitor._start: Error from getCheckSessionIframe:",t.message);}));},t.prototype._stop=function t(){this._sub=null,this._sid=null,this._checkSessionIFrame&&(i.Log.debug("SessionMonitor._stop"),this._checkSessionIFrame.stop());},t.prototype._callback=function t(){var e=this;this._userManager.querySessionStatus().then(function(t){var r=!0;t?t.sub===e._sub?(r=!1,e._checkSessionIFrame.start(t.session_state),t.sid===e._sid?i.Log.debug("SessionMonitor._callback: Same sub still logged in at OP, restarting check session iframe; session_state:",t.session_state):(i.Log.debug("SessionMonitor._callback: Same sub still logged in at OP, session state has changed, restarting check session iframe; session_state:",t.session_state),e._userManager.events._raiseUserSessionChanged())):i.Log.debug("SessionMonitor._callback: Different subject signed into OP:",t.sub):i.Log.debug("SessionMonitor._callback: Subject no longer signed into OP"),r&&(i.Log.debug("SessionMonitor._callback: SessionMonitor._callback; raising signed out event"),e._userManager.events._raiseUserSignedOut());}).catch(function(t){i.Log.debug("SessionMonitor._callback: Error calling queryCurrentSigninSession; raising signed out event",t.message),e._userManager.events._raiseUserSignedOut();});},n(t,[{key:"_settings",get:function t(){return this._userManager.settings}},{key:"_metadataService",get:function t(){return this._userManager.metadataService}},{key:"_client_id",get:function t(){return this._settings.client_id}},{key:"_checkSessionInterval",get:function t(){return this._settings.checkSessionInterval}},{key:"_stopCheckSessionOnError",get:function t(){return this._settings.stopCheckSessionOnError}}]),t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.CheckSessionIFrame=void 0;var n=r(0);var i=2e3;e.CheckSessionIFrame=function(){function t(e,r,n,o){var s=!(arguments.length>4&&void 0!==arguments[4])||arguments[4];!function a(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this._callback=e,this._client_id=r,this._url=n,this._interval=o||i,this._stopOnError=s;var u=n.indexOf("/",n.indexOf("//")+2);this._frame_origin=n.substr(0,u),this._frame=window.document.createElement("iframe"),this._frame.style.visibility="hidden",this._frame.style.position="absolute",this._frame.style.display="none",this._frame.style.width=0,this._frame.style.height=0,this._frame.src=n;}return t.prototype.load=function t(){var e=this;return new Promise(function(t){e._frame.onload=function(){t();},window.document.body.appendChild(e._frame),e._boundMessageEvent=e._message.bind(e),window.addEventListener("message",e._boundMessageEvent,!1);})},t.prototype._message=function t(e){e.origin===this._frame_origin&&e.source===this._frame.contentWindow&&("error"===e.data?(n.Log.error("CheckSessionIFrame: error message from check session op iframe"),this._stopOnError&&this.stop()):"changed"===e.data?(n.Log.debug("CheckSessionIFrame: changed message from check session op iframe"),this.stop(),this._callback()):n.Log.debug("CheckSessionIFrame: "+e.data+" message from check session op iframe"));},t.prototype.start=function t(e){var r=this;if(this._session_state!==e){n.Log.debug("CheckSessionIFrame.start"),this.stop(),this._session_state=e;var i=function t(){r._frame.contentWindow.postMessage(r._client_id+" "+r._session_state,r._frame_origin);};i(),this._timer=window.setInterval(i,this._interval);}},t.prototype.stop=function t(){this._session_state=null,this._timer&&(n.Log.debug("CheckSessionIFrame.stop"),window.clearInterval(this._timer),this._timer=null);},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.TokenRevocationClient=void 0;var n=r(0),i=r(2),o=r(1);e.TokenRevocationClient=function(){function t(e){var r=arguments.length>1&&void 0!==arguments[1]?arguments[1]:o.Global.XMLHttpRequest,s=arguments.length>2&&void 0!==arguments[2]?arguments[2]:i.MetadataService;if(function a(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),!e)throw n.Log.error("TokenRevocationClient.ctor: No settings provided"),new Error("No settings provided.");this._settings=e,this._XMLHttpRequestCtor=r,this._metadataService=new s(this._settings);}return t.prototype.revoke=function t(e,r){var i=this,o=arguments.length>2&&void 0!==arguments[2]?arguments[2]:"access_token";if(!e)throw n.Log.error("TokenRevocationClient.revoke: No token provided"),new Error("No token provided.");if("access_token"!==o&&"refresh_token"!=o)throw n.Log.error("TokenRevocationClient.revoke: Invalid token type"),new Error("Invalid token type.");return this._metadataService.getRevocationEndpoint().then(function(t){if(t){n.Log.debug("TokenRevocationClient.revoke: Revoking "+o);var s=i._settings.client_id,a=i._settings.client_secret;return i._revoke(t,s,a,e,o)}if(r)throw n.Log.error("TokenRevocationClient.revoke: Revocation not supported"),new Error("Revocation not supported")})},t.prototype._revoke=function t(e,r,i,o,s){var a=this;return new Promise(function(t,u){var c=new a._XMLHttpRequestCtor;c.open("POST",e),c.onload=function(){n.Log.debug("TokenRevocationClient.revoke: HTTP response received, status",c.status),200===c.status?t():u(Error(c.statusText+" ("+c.status+")"));},c.onerror=function(){n.Log.debug("TokenRevocationClient.revoke: Network Error."),u("Network Error");};var h="client_id="+encodeURIComponent(r);i&&(h+="&client_secret="+encodeURIComponent(i)),h+="&token_type_hint="+encodeURIComponent(s),h+="&token="+encodeURIComponent(o),c.setRequestHeader("Content-Type","application/x-www-form-urlencoded"),c.send(h);})},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.CordovaPopupWindow=void 0;var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),i=r(0);var o="location=no,toolbar=no,zoom=no",s="_blank";e.CordovaPopupWindow=function(){function t(e){var r=this;!function n(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this._promise=new Promise(function(t,e){r._resolve=t,r._reject=e;}),this.features=e.popupWindowFeatures||o,this.target=e.popupWindowTarget||s,this.redirect_uri=e.startUrl,i.Log.debug("CordovaPopupWindow.ctor: redirect_uri: "+this.redirect_uri);}return t.prototype._isInAppBrowserInstalled=function t(e){return ["cordova-plugin-inappbrowser","cordova-plugin-inappbrowser.inappbrowser","org.apache.cordova.inappbrowser"].some(function(t){return e.hasOwnProperty(t)})},t.prototype.navigate=function t(e){if(e&&e.url){if(!window.cordova)return this._error("cordova is undefined");var r=window.cordova.require("cordova/plugin_list").metadata;if(!1===this._isInAppBrowserInstalled(r))return this._error("InAppBrowser plugin not found");this._popup=cordova.InAppBrowser.open(e.url,this.target,this.features),this._popup?(i.Log.debug("CordovaPopupWindow.navigate: popup successfully created"),this._exitCallbackEvent=this._exitCallback.bind(this),this._loadStartCallbackEvent=this._loadStartCallback.bind(this),this._popup.addEventListener("exit",this._exitCallbackEvent,!1),this._popup.addEventListener("loadstart",this._loadStartCallbackEvent,!1)):this._error("Error opening popup window");}else this._error("No url provided");return this.promise},t.prototype._loadStartCallback=function t(e){0===e.url.indexOf(this.redirect_uri)&&this._success({url:e.url});},t.prototype._exitCallback=function t(e){this._error(e);},t.prototype._success=function t(e){this._cleanup(),i.Log.debug("CordovaPopupWindow: Successful response from cordova popup window"),this._resolve(e);},t.prototype._error=function t(e){this._cleanup(),i.Log.error(e),this._reject(new Error(e));},t.prototype.close=function t(){this._cleanup();},t.prototype._cleanup=function t(){this._popup&&(i.Log.debug("CordovaPopupWindow: cleaning up popup"),this._popup.removeEventListener("exit",this._exitCallbackEvent,!1),this._popup.removeEventListener("loadstart",this._loadStartCallbackEvent,!1),this._popup.close()),this._popup=null;},n(t,[{key:"promise",get:function t(){return this._promise}}]),t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0});var n=r(0),i=r(9),o=r(5),s=r(6),a=r(39),u=r(40),c=r(16),h=r(2),l=r(50),f=r(51),d=r(19),p=r(20),g=r(18),v=r(1),y=r(15),m=r(52);e.default={Version:m.Version,Log:n.Log,OidcClient:i.OidcClient,OidcClientSettings:o.OidcClientSettings,WebStorageStateStore:s.WebStorageStateStore,InMemoryWebStorage:a.InMemoryWebStorage,UserManager:u.UserManager,AccessTokenEvents:c.AccessTokenEvents,MetadataService:h.MetadataService,CordovaPopupNavigator:l.CordovaPopupNavigator,CordovaIFrameNavigator:f.CordovaIFrameNavigator,CheckSessionIFrame:d.CheckSessionIFrame,TokenRevocationClient:p.TokenRevocationClient,SessionMonitor:g.SessionMonitor,Global:v.Global,User:y.User},t.exports=e.default;},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.ResponseValidator=void 0;var n="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},i=r(0),o=r(2),s=r(24),a=r(10),u=r(11),c=r(4);var h=["nonce","at_hash","iat","nbf","exp","aud","iss","c_hash"];e.ResponseValidator=function(){function t(e){var r=arguments.length>1&&void 0!==arguments[1]?arguments[1]:o.MetadataService,n=arguments.length>2&&void 0!==arguments[2]?arguments[2]:s.UserInfoService,u=arguments.length>3&&void 0!==arguments[3]?arguments[3]:c.JoseUtil,h=arguments.length>4&&void 0!==arguments[4]?arguments[4]:a.TokenClient;if(function l(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),!e)throw i.Log.error("ResponseValidator.ctor: No settings passed to ResponseValidator"),new Error("settings");this._settings=e,this._metadataService=new r(this._settings),this._userInfoService=new n(this._settings),this._joseUtil=u,this._tokenClient=new h(this._settings);}return t.prototype.validateSigninResponse=function t(e,r){var n=this;return i.Log.debug("ResponseValidator.validateSigninResponse"),this._processSigninParams(e,r).then(function(t){return i.Log.debug("ResponseValidator.validateSigninResponse: state processed"),n._validateTokens(e,t).then(function(t){return i.Log.debug("ResponseValidator.validateSigninResponse: tokens validated"),n._processClaims(e,t).then(function(t){return i.Log.debug("ResponseValidator.validateSigninResponse: claims processed"),t})})})},t.prototype.validateSignoutResponse=function t(e,r){return e.id!==r.state?(i.Log.error("ResponseValidator.validateSignoutResponse: State does not match"),Promise.reject(new Error("State does not match"))):(i.Log.debug("ResponseValidator.validateSignoutResponse: state validated"),r.state=e.data,r.error?(i.Log.warn("ResponseValidator.validateSignoutResponse: Response was error",r.error),Promise.reject(new u.ErrorResponse(r))):Promise.resolve(r))},t.prototype._processSigninParams=function t(e,r){if(e.id!==r.state)return i.Log.error("ResponseValidator._processSigninParams: State does not match"),Promise.reject(new Error("State does not match"));if(!e.client_id)return i.Log.error("ResponseValidator._processSigninParams: No client_id on state"),Promise.reject(new Error("No client_id on state"));if(!e.authority)return i.Log.error("ResponseValidator._processSigninParams: No authority on state"),Promise.reject(new Error("No authority on state"));if(this._settings.authority){if(this._settings.authority&&this._settings.authority!==e.authority)return i.Log.error("ResponseValidator._processSigninParams: authority mismatch on settings vs. signin state"),Promise.reject(new Error("authority mismatch on settings vs. signin state"))}else this._settings.authority=e.authority;if(this._settings.client_id){if(this._settings.client_id&&this._settings.client_id!==e.client_id)return i.Log.error("ResponseValidator._processSigninParams: client_id mismatch on settings vs. signin state"),Promise.reject(new Error("client_id mismatch on settings vs. signin state"))}else this._settings.client_id=e.client_id;return i.Log.debug("ResponseValidator._processSigninParams: state validated"),r.state=e.data,r.error?(i.Log.warn("ResponseValidator._processSigninParams: Response was error",r.error),Promise.reject(new u.ErrorResponse(r))):e.nonce&&!r.id_token?(i.Log.error("ResponseValidator._processSigninParams: Expecting id_token in response"),Promise.reject(new Error("No id_token in response"))):!e.nonce&&r.id_token?(i.Log.error("ResponseValidator._processSigninParams: Not expecting id_token in response"),Promise.reject(new Error("Unexpected id_token in response"))):e.code_verifier&&!r.code?(i.Log.error("ResponseValidator._processSigninParams: Expecting code in response"),Promise.reject(new Error("No code in response"))):!e.code_verifier&&r.code?(i.Log.error("ResponseValidator._processSigninParams: Not expecting code in response"),Promise.reject(new Error("Unexpected code in response"))):(r.scope||(r.scope=e.scope),Promise.resolve(r))},t.prototype._processClaims=function t(e,r){var n=this;if(r.isOpenIdConnect){if(i.Log.debug("ResponseValidator._processClaims: response is OIDC, processing claims"),r.profile=this._filterProtocolClaims(r.profile),!0!==e.skipUserInfo&&this._settings.loadUserInfo&&r.access_token)return i.Log.debug("ResponseValidator._processClaims: loading user info"),this._userInfoService.getClaims(r.access_token).then(function(t){return i.Log.debug("ResponseValidator._processClaims: user info claims received from user info endpoint"),t.sub!==r.profile.sub?(i.Log.error("ResponseValidator._processClaims: sub from user info endpoint does not match sub in access_token"),Promise.reject(new Error("sub from user info endpoint does not match sub in access_token"))):(r.profile=n._mergeClaims(r.profile,t),i.Log.debug("ResponseValidator._processClaims: user info claims received, updated profile:",r.profile),r)});i.Log.debug("ResponseValidator._processClaims: not loading user info");}else i.Log.debug("ResponseValidator._processClaims: response is not OIDC, not processing claims");return Promise.resolve(r)},t.prototype._mergeClaims=function t(e,r){var i=Object.assign({},e);for(var o in r){var s=r[o];Array.isArray(s)||(s=[s]);for(var a=0;a<s.length;a++){var u=s[a];i[o]?Array.isArray(i[o])?i[o].indexOf(u)<0&&i[o].push(u):i[o]!==u&&("object"===(void 0===u?"undefined":n(u))?i[o]=this._mergeClaims(i[o],u):i[o]=[i[o],u]):i[o]=u;}}return i},t.prototype._filterProtocolClaims=function t(e){i.Log.debug("ResponseValidator._filterProtocolClaims, incoming claims:",e);var r=Object.assign({},e);return this._settings._filterProtocolClaims?(h.forEach(function(t){delete r[t];}),i.Log.debug("ResponseValidator._filterProtocolClaims: protocol claims filtered",r)):i.Log.debug("ResponseValidator._filterProtocolClaims: protocol claims not filtered"),r},t.prototype._validateTokens=function t(e,r){return r.code?(i.Log.debug("ResponseValidator._validateTokens: Validating code"),this._processCode(e,r)):r.id_token?r.access_token?(i.Log.debug("ResponseValidator._validateTokens: Validating id_token and access_token"),this._validateIdTokenAndAccessToken(e,r)):(i.Log.debug("ResponseValidator._validateTokens: Validating id_token"),this._validateIdToken(e,r)):(i.Log.debug("ResponseValidator._validateTokens: No code to process or id_token to validate"),Promise.resolve(r))},t.prototype._processCode=function t(e,r){var o=this,s={client_id:e.client_id,client_secret:e.client_secret,code:r.code,redirect_uri:e.redirect_uri,code_verifier:e.code_verifier};return e.extraTokenParams&&"object"===n(e.extraTokenParams)&&Object.assign(s,e.extraTokenParams),this._tokenClient.exchangeCode(s).then(function(t){for(var n in t)r[n]=t[n];return r.id_token?(i.Log.debug("ResponseValidator._processCode: token response successful, processing id_token"),o._validateIdTokenAttributes(e,r)):(i.Log.debug("ResponseValidator._processCode: token response successful, returning response"),r)})},t.prototype._validateIdTokenAttributes=function t(e,r){var n=this;return this._metadataService.getIssuer().then(function(t){var o=e.client_id,s=n._settings.clockSkew;return i.Log.debug("ResponseValidator._validateIdTokenAttributes: Validaing JWT attributes; using clock skew (in seconds) of: ",s),n._joseUtil.validateJwtAttributes(r.id_token,t,o,s).then(function(t){return e.nonce&&e.nonce!==t.nonce?(i.Log.error("ResponseValidator._validateIdTokenAttributes: Invalid nonce in id_token"),Promise.reject(new Error("Invalid nonce in id_token"))):t.sub?(r.profile=t,r):(i.Log.error("ResponseValidator._validateIdTokenAttributes: No sub present in id_token"),Promise.reject(new Error("No sub present in id_token")))})})},t.prototype._validateIdTokenAndAccessToken=function t(e,r){var n=this;return this._validateIdToken(e,r).then(function(t){return n._validateAccessToken(t)})},t.prototype._validateIdToken=function t(e,r){var n=this;if(!e.nonce)return i.Log.error("ResponseValidator._validateIdToken: No nonce on state"),Promise.reject(new Error("No nonce on state"));var o=this._joseUtil.parseJwt(r.id_token);if(!o||!o.header||!o.payload)return i.Log.error("ResponseValidator._validateIdToken: Failed to parse id_token",o),Promise.reject(new Error("Failed to parse id_token"));if(e.nonce!==o.payload.nonce)return i.Log.error("ResponseValidator._validateIdToken: Invalid nonce in id_token"),Promise.reject(new Error("Invalid nonce in id_token"));var s=o.header.kid;return this._metadataService.getIssuer().then(function(t){return i.Log.debug("ResponseValidator._validateIdToken: Received issuer"),n._metadataService.getSigningKeys().then(function(a){if(!a)return i.Log.error("ResponseValidator._validateIdToken: No signing keys from metadata"),Promise.reject(new Error("No signing keys from metadata"));i.Log.debug("ResponseValidator._validateIdToken: Received signing keys");var u=void 0;if(s)u=a.filter(function(t){return t.kid===s})[0];else{if((a=n._filterByAlg(a,o.header.alg)).length>1)return i.Log.error("ResponseValidator._validateIdToken: No kid found in id_token and more than one key found in metadata"),Promise.reject(new Error("No kid found in id_token and more than one key found in metadata"));u=a[0];}if(!u)return i.Log.error("ResponseValidator._validateIdToken: No key matching kid or alg found in signing keys"),Promise.reject(new Error("No key matching kid or alg found in signing keys"));var c=e.client_id,h=n._settings.clockSkew;return i.Log.debug("ResponseValidator._validateIdToken: Validaing JWT; using clock skew (in seconds) of: ",h),n._joseUtil.validateJwt(r.id_token,u,t,c,h).then(function(){return i.Log.debug("ResponseValidator._validateIdToken: JWT validation successful"),o.payload.sub?(r.profile=o.payload,r):(i.Log.error("ResponseValidator._validateIdToken: No sub present in id_token"),Promise.reject(new Error("No sub present in id_token")))})})})},t.prototype._filterByAlg=function t(e,r){var n=null;if(r.startsWith("RS"))n="RSA";else if(r.startsWith("PS"))n="PS";else{if(!r.startsWith("ES"))return i.Log.debug("ResponseValidator._filterByAlg: alg not supported: ",r),[];n="EC";}return i.Log.debug("ResponseValidator._filterByAlg: Looking for keys that match kty: ",n),e=e.filter(function(t){return t.kty===n}),i.Log.debug("ResponseValidator._filterByAlg: Number of keys that match kty: ",n,e.length),e},t.prototype._validateAccessToken=function t(e){if(!e.profile)return i.Log.error("ResponseValidator._validateAccessToken: No profile loaded from id_token"),Promise.reject(new Error("No profile loaded from id_token"));if(!e.profile.at_hash)return i.Log.error("ResponseValidator._validateAccessToken: No at_hash in id_token"),Promise.reject(new Error("No at_hash in id_token"));if(!e.id_token)return i.Log.error("ResponseValidator._validateAccessToken: No id_token"),Promise.reject(new Error("No id_token"));var r=this._joseUtil.parseJwt(e.id_token);if(!r||!r.header)return i.Log.error("ResponseValidator._validateAccessToken: Failed to parse id_token",r),Promise.reject(new Error("Failed to parse id_token"));var n=r.header.alg;if(!n||5!==n.length)return i.Log.error("ResponseValidator._validateAccessToken: Unsupported alg:",n),Promise.reject(new Error("Unsupported alg: "+n));var o=n.substr(2,3);if(!o)return i.Log.error("ResponseValidator._validateAccessToken: Unsupported alg:",n,o),Promise.reject(new Error("Unsupported alg: "+n));if(256!==(o=parseInt(o))&&384!==o&&512!==o)return i.Log.error("ResponseValidator._validateAccessToken: Unsupported alg:",n,o),Promise.reject(new Error("Unsupported alg: "+n));var s="sha"+o,a=this._joseUtil.hashString(e.access_token,s);if(!a)return i.Log.error("ResponseValidator._validateAccessToken: access_token hash failed:",s),Promise.reject(new Error("Failed to validate at_hash"));var u=a.substr(0,a.length/2),c=this._joseUtil.hexToBase64Url(u);return c!==e.profile.at_hash?(i.Log.error("ResponseValidator._validateAccessToken: Failed to validate at_hash",c,e.profile.at_hash),Promise.reject(new Error("Failed to validate at_hash"))):(i.Log.debug("ResponseValidator._validateAccessToken: success"),Promise.resolve(e))},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.UserInfoService=void 0;var n=r(7),i=r(2),o=r(0),s=r(4);e.UserInfoService=function(){function t(e){var r=arguments.length>1&&void 0!==arguments[1]?arguments[1]:n.JsonService,a=arguments.length>2&&void 0!==arguments[2]?arguments[2]:i.MetadataService,u=arguments.length>3&&void 0!==arguments[3]?arguments[3]:s.JoseUtil;if(function c(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),!e)throw o.Log.error("UserInfoService.ctor: No settings passed"),new Error("settings");this._settings=e,this._jsonService=new r(void 0,void 0,this._getClaimsFromJwt.bind(this)),this._metadataService=new a(this._settings),this._joseUtil=u;}return t.prototype.getClaims=function t(e){var r=this;return e?this._metadataService.getUserInfoEndpoint().then(function(t){return o.Log.debug("UserInfoService.getClaims: received userinfo url",t),r._jsonService.getJson(t,e).then(function(t){return o.Log.debug("UserInfoService.getClaims: claims received",t),t})}):(o.Log.error("UserInfoService.getClaims: No token passed"),Promise.reject(new Error("A token is required")))},t.prototype._getClaimsFromJwt=function t(e){var r=this;try{var n=this._joseUtil.parseJwt(e.responseText);if(!n||!n.header||!n.payload)return o.Log.error("UserInfoService._getClaimsFromJwt: Failed to parse JWT",n),Promise.reject(new Error("Failed to parse id_token"));var i=n.header.kid,s=void 0;switch(this._settings.userInfoJwtIssuer){case"OP":s=this._metadataService.getIssuer();break;case"ANY":s=Promise.resolve(n.payload.iss);break;default:s=Promise.resolve(this._settings.userInfoJwtIssuer);}return s.then(function(t){return o.Log.debug("UserInfoService._getClaimsFromJwt: Received issuer:"+t),r._metadataService.getSigningKeys().then(function(s){if(!s)return o.Log.error("UserInfoService._getClaimsFromJwt: No signing keys from metadata"),Promise.reject(new Error("No signing keys from metadata"));o.Log.debug("UserInfoService._getClaimsFromJwt: Received signing keys");var a=void 0;if(i)a=s.filter(function(t){return t.kid===i})[0];else{if((s=r._filterByAlg(s,n.header.alg)).length>1)return o.Log.error("UserInfoService._getClaimsFromJwt: No kid found in id_token and more than one key found in metadata"),Promise.reject(new Error("No kid found in id_token and more than one key found in metadata"));a=s[0];}if(!a)return o.Log.error("UserInfoService._getClaimsFromJwt: No key matching kid or alg found in signing keys"),Promise.reject(new Error("No key matching kid or alg found in signing keys"));var u=r._settings.client_id,c=r._settings.clockSkew;return o.Log.debug("UserInfoService._getClaimsFromJwt: Validaing JWT; using clock skew (in seconds) of: ",c),r._joseUtil.validateJwt(e.responseText,a,t,u,c,void 0,!0).then(function(){return o.Log.debug("UserInfoService._getClaimsFromJwt: JWT validation successful"),n.payload})})})}catch(t){return o.Log.error("UserInfoService._getClaimsFromJwt: Error parsing JWT response",t.message),void reject(t)}},t.prototype._filterByAlg=function t(e,r){var n=null;if(r.startsWith("RS"))n="RSA";else if(r.startsWith("PS"))n="PS";else{if(!r.startsWith("ES"))return o.Log.debug("UserInfoService._filterByAlg: alg not supported: ",r),[];n="EC";}return o.Log.debug("UserInfoService._filterByAlg: Looking for keys that match kty: ",n),e=e.filter(function(t){return t.kty===n}),o.Log.debug("UserInfoService._filterByAlg: Number of keys that match kty: ",n,e.length),e},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.AllowedSigningAlgs=e.b64tohex=e.hextob64u=e.crypto=e.X509=e.KeyUtil=e.jws=void 0;var n=r(26);e.jws=n.jws,e.KeyUtil=n.KEYUTIL,e.X509=n.X509,e.crypto=n.crypto,e.hextob64u=n.hextob64u,e.b64tohex=n.b64tohex,e.AllowedSigningAlgs=["RS256","RS384","RS512","PS256","PS384","PS512","ES256","ES384","ES512"];},function(t,e,r){(function(t){Object.defineProperty(e,"__esModule",{value:!0});var r="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},n={userAgent:!1},i={};
    /*!
    Copyright (c) 2011, Yahoo! Inc. All rights reserved.
    Code licensed under the BSD License:
    http://developer.yahoo.com/yui/license.html
    version: 2.9.0
    */
    if(void 0===o)var o={};o.lang={extend:function t(e,r,i){if(!r||!e)throw new Error("YAHOO.lang.extend failed, please check that all dependencies are included.");var o=function t(){};if(o.prototype=r.prototype,e.prototype=new o,e.prototype.constructor=e,e.superclass=r.prototype,r.prototype.constructor==Object.prototype.constructor&&(r.prototype.constructor=r),i){var s;for(s in i)e.prototype[s]=i[s];var a=function t(){},u=["toString","valueOf"];try{/MSIE/.test(n.userAgent)&&(a=function t(e,r){for(s=0;s<u.length;s+=1){var n=u[s],i=r[n];"function"==typeof i&&i!=Object.prototype[n]&&(e[n]=i);}});}catch(t){}a(e.prototype,i);}}};
    /*! CryptoJS v3.1.2 core-fix.js
     * code.google.com/p/crypto-js
     * (c) 2009-2013 by Jeff Mott. All rights reserved.
     * code.google.com/p/crypto-js/wiki/License
     * THIS IS FIX of 'core.js' to fix Hmac issue.
     * https://code.google.com/p/crypto-js/issues/detail?id=84
     * https://crypto-js.googlecode.com/svn-history/r667/branches/3.x/src/core.js
     */
    var s,a,u,c,h,l,f,d,p,g,v,y=y||(s=Math,u=(a={}).lib={},c=u.Base=function(){function t(){}return {extend:function e(r){t.prototype=this;var n=new t;return r&&n.mixIn(r),n.hasOwnProperty("init")||(n.init=function(){n.$super.init.apply(this,arguments);}),n.init.prototype=n,n.$super=this,n},create:function t(){var e=this.extend();return e.init.apply(e,arguments),e},init:function t(){},mixIn:function t(e){for(var r in e)e.hasOwnProperty(r)&&(this[r]=e[r]);e.hasOwnProperty("toString")&&(this.toString=e.toString);},clone:function t(){return this.init.prototype.extend(this)}}}(),h=u.WordArray=c.extend({init:function t(e,r){e=this.words=e||[],this.sigBytes=void 0!=r?r:4*e.length;},toString:function t(e){return (e||f).stringify(this)},concat:function t(e){var r=this.words,n=e.words,i=this.sigBytes,o=e.sigBytes;if(this.clamp(),i%4)for(var s=0;s<o;s++){var a=n[s>>>2]>>>24-s%4*8&255;r[i+s>>>2]|=a<<24-(i+s)%4*8;}else for(s=0;s<o;s+=4)r[i+s>>>2]=n[s>>>2];return this.sigBytes+=o,this},clamp:function t(){var e=this.words,r=this.sigBytes;e[r>>>2]&=4294967295<<32-r%4*8,e.length=s.ceil(r/4);},clone:function t(){var e=c.clone.call(this);return e.words=this.words.slice(0),e},random:function t(e){for(var r=[],n=0;n<e;n+=4)r.push(4294967296*s.random()|0);return new h.init(r,e)}}),l=a.enc={},f=l.Hex={stringify:function t(e){for(var r=e.words,n=e.sigBytes,i=[],o=0;o<n;o++){var s=r[o>>>2]>>>24-o%4*8&255;i.push((s>>>4).toString(16)),i.push((15&s).toString(16));}return i.join("")},parse:function t(e){for(var r=e.length,n=[],i=0;i<r;i+=2)n[i>>>3]|=parseInt(e.substr(i,2),16)<<24-i%8*4;return new h.init(n,r/2)}},d=l.Latin1={stringify:function t(e){for(var r=e.words,n=e.sigBytes,i=[],o=0;o<n;o++){var s=r[o>>>2]>>>24-o%4*8&255;i.push(String.fromCharCode(s));}return i.join("")},parse:function t(e){for(var r=e.length,n=[],i=0;i<r;i++)n[i>>>2]|=(255&e.charCodeAt(i))<<24-i%4*8;return new h.init(n,r)}},p=l.Utf8={stringify:function t(e){try{return decodeURIComponent(escape(d.stringify(e)))}catch(t){throw new Error("Malformed UTF-8 data")}},parse:function t(e){return d.parse(unescape(encodeURIComponent(e)))}},g=u.BufferedBlockAlgorithm=c.extend({reset:function t(){this._data=new h.init,this._nDataBytes=0;},_append:function t(e){"string"==typeof e&&(e=p.parse(e)),this._data.concat(e),this._nDataBytes+=e.sigBytes;},_process:function t(e){var r=this._data,n=r.words,i=r.sigBytes,o=this.blockSize,a=i/(4*o),u=(a=e?s.ceil(a):s.max((0|a)-this._minBufferSize,0))*o,c=s.min(4*u,i);if(u){for(var l=0;l<u;l+=o)this._doProcessBlock(n,l);var f=n.splice(0,u);r.sigBytes-=c;}return new h.init(f,c)},clone:function t(){var e=c.clone.call(this);return e._data=this._data.clone(),e},_minBufferSize:0}),u.Hasher=g.extend({cfg:c.extend(),init:function t(e){this.cfg=this.cfg.extend(e),this.reset();},reset:function t(){g.reset.call(this),this._doReset();},update:function t(e){return this._append(e),this._process(),this},finalize:function t(e){return e&&this._append(e),this._doFinalize()},blockSize:16,_createHelper:function t(e){return function(t,r){return new e.init(r).finalize(t)}},_createHmacHelper:function t(e){return function(t,r){return new v.HMAC.init(e,r).finalize(t)}}}),v=a.algo={},a);!function(t){var e,r=(e=y).lib,n=r.Base,i=r.WordArray;(e=e.x64={}).Word=n.extend({init:function t(e,r){this.high=e,this.low=r;}}),e.WordArray=n.extend({init:function t(e,r){e=this.words=e||[],this.sigBytes=void 0!=r?r:8*e.length;},toX32:function t(){for(var e=this.words,r=e.length,n=[],o=0;o<r;o++){var s=e[o];n.push(s.high),n.push(s.low);}return i.create(n,this.sigBytes)},clone:function t(){for(var e=n.clone.call(this),r=e.words=this.words.slice(0),i=r.length,o=0;o<i;o++)r[o]=r[o].clone();return e}});}(),function(){var t=y,e=t.lib.WordArray;t.enc.Base64={stringify:function t(e){var r=e.words,n=e.sigBytes,i=this._map;e.clamp(),e=[];for(var o=0;o<n;o+=3)for(var s=(r[o>>>2]>>>24-o%4*8&255)<<16|(r[o+1>>>2]>>>24-(o+1)%4*8&255)<<8|r[o+2>>>2]>>>24-(o+2)%4*8&255,a=0;4>a&&o+.75*a<n;a++)e.push(i.charAt(s>>>6*(3-a)&63));if(r=i.charAt(64))for(;e.length%4;)e.push(r);return e.join("")},parse:function t(r){var n=r.length,i=this._map;(o=i.charAt(64))&&(-1!=(o=r.indexOf(o))&&(n=o));for(var o=[],s=0,a=0;a<n;a++)if(a%4){var u=i.indexOf(r.charAt(a-1))<<a%4*2,c=i.indexOf(r.charAt(a))>>>6-a%4*2;o[s>>>2]|=(u|c)<<24-s%4*8,s++;}return e.create(o,s)},_map:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="};}(),function(t){for(var e=y,r=(i=e.lib).WordArray,n=i.Hasher,i=e.algo,o=[],s=[],a=function t(e){return 4294967296*(e-(0|e))|0},u=2,c=0;64>c;){var h;t:{h=u;for(var l=t.sqrt(h),f=2;f<=l;f++)if(!(h%f)){h=!1;break t}h=!0;}h&&(8>c&&(o[c]=a(t.pow(u,.5))),s[c]=a(t.pow(u,1/3)),c++),u++;}var d=[];i=i.SHA256=n.extend({_doReset:function t(){this._hash=new r.init(o.slice(0));},_doProcessBlock:function t(e,r){for(var n=this._hash.words,i=n[0],o=n[1],a=n[2],u=n[3],c=n[4],h=n[5],l=n[6],f=n[7],p=0;64>p;p++){if(16>p)d[p]=0|e[r+p];else{var g=d[p-15],v=d[p-2];d[p]=((g<<25|g>>>7)^(g<<14|g>>>18)^g>>>3)+d[p-7]+((v<<15|v>>>17)^(v<<13|v>>>19)^v>>>10)+d[p-16];}g=f+((c<<26|c>>>6)^(c<<21|c>>>11)^(c<<7|c>>>25))+(c&h^~c&l)+s[p]+d[p],v=((i<<30|i>>>2)^(i<<19|i>>>13)^(i<<10|i>>>22))+(i&o^i&a^o&a),f=l,l=h,h=c,c=u+g|0,u=a,a=o,o=i,i=g+v|0;}n[0]=n[0]+i|0,n[1]=n[1]+o|0,n[2]=n[2]+a|0,n[3]=n[3]+u|0,n[4]=n[4]+c|0,n[5]=n[5]+h|0,n[6]=n[6]+l|0,n[7]=n[7]+f|0;},_doFinalize:function e(){var r=this._data,n=r.words,i=8*this._nDataBytes,o=8*r.sigBytes;return n[o>>>5]|=128<<24-o%32,n[14+(o+64>>>9<<4)]=t.floor(i/4294967296),n[15+(o+64>>>9<<4)]=i,r.sigBytes=4*n.length,this._process(),this._hash},clone:function t(){var e=n.clone.call(this);return e._hash=this._hash.clone(),e}});e.SHA256=n._createHelper(i),e.HmacSHA256=n._createHmacHelper(i);}(Math),function(){function t(){return n.create.apply(n,arguments)}for(var e=y,r=e.lib.Hasher,n=(o=e.x64).Word,i=o.WordArray,o=e.algo,s=[t(1116352408,3609767458),t(1899447441,602891725),t(3049323471,3964484399),t(3921009573,2173295548),t(961987163,4081628472),t(1508970993,3053834265),t(2453635748,2937671579),t(2870763221,3664609560),t(3624381080,2734883394),t(310598401,1164996542),t(607225278,1323610764),t(1426881987,3590304994),t(1925078388,4068182383),t(2162078206,991336113),t(2614888103,633803317),t(3248222580,3479774868),t(3835390401,2666613458),t(4022224774,944711139),t(264347078,2341262773),t(604807628,2007800933),t(770255983,1495990901),t(1249150122,1856431235),t(1555081692,3175218132),t(1996064986,2198950837),t(2554220882,3999719339),t(2821834349,766784016),t(2952996808,2566594879),t(3210313671,3203337956),t(3336571891,1034457026),t(3584528711,2466948901),t(113926993,3758326383),t(338241895,168717936),t(666307205,1188179964),t(773529912,1546045734),t(1294757372,1522805485),t(1396182291,2643833823),t(1695183700,2343527390),t(1986661051,1014477480),t(2177026350,1206759142),t(2456956037,344077627),t(2730485921,1290863460),t(2820302411,3158454273),t(3259730800,3505952657),t(3345764771,106217008),t(3516065817,3606008344),t(3600352804,1432725776),t(4094571909,1467031594),t(275423344,851169720),t(430227734,3100823752),t(506948616,1363258195),t(659060556,3750685593),t(883997877,3785050280),t(958139571,3318307427),t(1322822218,3812723403),t(1537002063,2003034995),t(1747873779,3602036899),t(1955562222,1575990012),t(2024104815,1125592928),t(2227730452,2716904306),t(2361852424,442776044),t(2428436474,593698344),t(2756734187,3733110249),t(3204031479,2999351573),t(3329325298,3815920427),t(3391569614,3928383900),t(3515267271,566280711),t(3940187606,3454069534),t(4118630271,4000239992),t(116418474,1914138554),t(174292421,2731055270),t(289380356,3203993006),t(460393269,320620315),t(685471733,587496836),t(852142971,1086792851),t(1017036298,365543100),t(1126000580,2618297676),t(1288033470,3409855158),t(1501505948,4234509866),t(1607167915,987167468),t(1816402316,1246189591)],a=[],u=0;80>u;u++)a[u]=t();o=o.SHA512=r.extend({_doReset:function t(){this._hash=new i.init([new n.init(1779033703,4089235720),new n.init(3144134277,2227873595),new n.init(1013904242,4271175723),new n.init(2773480762,1595750129),new n.init(1359893119,2917565137),new n.init(2600822924,725511199),new n.init(528734635,4215389547),new n.init(1541459225,327033209)]);},_doProcessBlock:function t(e,r){for(var n=(f=this._hash.words)[0],i=f[1],o=f[2],u=f[3],c=f[4],h=f[5],l=f[6],f=f[7],d=n.high,p=n.low,g=i.high,v=i.low,y=o.high,m=o.low,_=u.high,S=u.low,F=c.high,b=c.low,w=h.high,E=h.low,x=l.high,k=l.low,A=f.high,P=f.low,C=d,T=p,R=g,I=v,D=y,L=m,U=_,B=S,N=F,O=b,j=w,H=E,M=x,K=k,V=A,q=P,J=0;80>J;J++){var W=a[J];if(16>J)var z=W.high=0|e[r+2*J],Y=W.low=0|e[r+2*J+1];else{z=((Y=(z=a[J-15]).high)>>>1|(G=z.low)<<31)^(Y>>>8|G<<24)^Y>>>7;var G=(G>>>1|Y<<31)^(G>>>8|Y<<24)^(G>>>7|Y<<25),X=((Y=(X=a[J-2]).high)>>>19|(Q=X.low)<<13)^(Y<<3|Q>>>29)^Y>>>6,Q=(Q>>>19|Y<<13)^(Q<<3|Y>>>29)^(Q>>>6|Y<<26),$=(Y=a[J-7]).high,Z=(tt=a[J-16]).high,tt=tt.low;z=(z=(z=z+$+((Y=G+Y.low)>>>0<G>>>0?1:0))+X+((Y=Y+Q)>>>0<Q>>>0?1:0))+Z+((Y=Y+tt)>>>0<tt>>>0?1:0);W.high=z,W.low=Y;}$=N&j^~N&M,tt=O&H^~O&K,W=C&R^C&D^R&D;var et=T&I^T&L^I&L,rt=(G=(C>>>28|T<<4)^(C<<30|T>>>2)^(C<<25|T>>>7),X=(T>>>28|C<<4)^(T<<30|C>>>2)^(T<<25|C>>>7),(Q=s[J]).high),nt=Q.low;Z=(Z=(Z=(Z=V+((N>>>14|O<<18)^(N>>>18|O<<14)^(N<<23|O>>>9))+((Q=q+((O>>>14|N<<18)^(O>>>18|N<<14)^(O<<23|N>>>9)))>>>0<q>>>0?1:0))+$+((Q=Q+tt)>>>0<tt>>>0?1:0))+rt+((Q=Q+nt)>>>0<nt>>>0?1:0))+z+((Q=Q+Y)>>>0<Y>>>0?1:0),W=G+W+((Y=X+et)>>>0<X>>>0?1:0),V=M,q=K,M=j,K=H,j=N,H=O,N=U+Z+((O=B+Q|0)>>>0<B>>>0?1:0)|0,U=D,B=L,D=R,L=I,R=C,I=T,C=Z+W+((T=Q+Y|0)>>>0<Q>>>0?1:0)|0;}p=n.low=p+T,n.high=d+C+(p>>>0<T>>>0?1:0),v=i.low=v+I,i.high=g+R+(v>>>0<I>>>0?1:0),m=o.low=m+L,o.high=y+D+(m>>>0<L>>>0?1:0),S=u.low=S+B,u.high=_+U+(S>>>0<B>>>0?1:0),b=c.low=b+O,c.high=F+N+(b>>>0<O>>>0?1:0),E=h.low=E+H,h.high=w+j+(E>>>0<H>>>0?1:0),k=l.low=k+K,l.high=x+M+(k>>>0<K>>>0?1:0),P=f.low=P+q,f.high=A+V+(P>>>0<q>>>0?1:0);},_doFinalize:function t(){var e=this._data,r=e.words,n=8*this._nDataBytes,i=8*e.sigBytes;return r[i>>>5]|=128<<24-i%32,r[30+(i+128>>>10<<5)]=Math.floor(n/4294967296),r[31+(i+128>>>10<<5)]=n,e.sigBytes=4*r.length,this._process(),this._hash.toX32()},clone:function t(){var e=r.clone.call(this);return e._hash=this._hash.clone(),e},blockSize:32}),e.SHA512=r._createHelper(o),e.HmacSHA512=r._createHmacHelper(o);}(),function(){var t=y,e=(i=t.x64).Word,r=i.WordArray,n=(i=t.algo).SHA512,i=i.SHA384=n.extend({_doReset:function t(){this._hash=new r.init([new e.init(3418070365,3238371032),new e.init(1654270250,914150663),new e.init(2438529370,812702999),new e.init(355462360,4144912697),new e.init(1731405415,4290775857),new e.init(2394180231,1750603025),new e.init(3675008525,1694076839),new e.init(1203062813,3204075428)]);},_doFinalize:function t(){var e=n._doFinalize.call(this);return e.sigBytes-=16,e}});t.SHA384=n._createHelper(i),t.HmacSHA384=n._createHmacHelper(i);}();
    /*! (c) Tom Wu | http://www-cs-students.stanford.edu/~tjw/jsbn/
     */
    var m,_="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",S="=";function F(t){var e,r,n="";for(e=0;e+3<=t.length;e+=3)r=parseInt(t.substring(e,e+3),16),n+=_.charAt(r>>6)+_.charAt(63&r);if(e+1==t.length?(r=parseInt(t.substring(e,e+1),16),n+=_.charAt(r<<2)):e+2==t.length&&(r=parseInt(t.substring(e,e+2),16),n+=_.charAt(r>>2)+_.charAt((3&r)<<4)),S)for(;(3&n.length)>0;)n+=S;return n}function b(t){var e,r,n,i="",o=0;for(e=0;e<t.length&&t.charAt(e)!=S;++e)(n=_.indexOf(t.charAt(e)))<0||(0==o?(i+=D(n>>2),r=3&n,o=1):1==o?(i+=D(r<<2|n>>4),r=15&n,o=2):2==o?(i+=D(r),i+=D(n>>2),r=3&n,o=3):(i+=D(r<<2|n>>4),i+=D(15&n),o=0));return 1==o&&(i+=D(r<<2)),i}function w(t){var e,r=b(t),n=new Array;for(e=0;2*e<r.length;++e)n[e]=parseInt(r.substring(2*e,2*e+2),16);return n}function E(t,e,r){null!=t&&("number"==typeof t?this.fromNumber(t,e,r):null==e&&"string"!=typeof t?this.fromString(t,256):this.fromString(t,e));}function x(){return new E(null)}(E.prototype.am=function A(t,e,r,n,i,o){for(;--o>=0;){var s=e*this[t++]+r[n]+i;i=Math.floor(s/67108864),r[n++]=67108863&s;}return i},m=26),E.prototype.DB=m,E.prototype.DM=(1<<m)-1,E.prototype.DV=1<<m;E.prototype.FV=Math.pow(2,52),E.prototype.F1=52-m,E.prototype.F2=2*m-52;var C,T,R="0123456789abcdefghijklmnopqrstuvwxyz",I=new Array;for(C="0".charCodeAt(0),T=0;T<=9;++T)I[C++]=T;for(C="a".charCodeAt(0),T=10;T<36;++T)I[C++]=T;for(C="A".charCodeAt(0),T=10;T<36;++T)I[C++]=T;function D(t){return R.charAt(t)}function L(t,e){var r=I[t.charCodeAt(e)];return null==r?-1:r}function U(t){var e=x();return e.fromInt(t),e}function B(t){var e,r=1;return 0!=(e=t>>>16)&&(t=e,r+=16),0!=(e=t>>8)&&(t=e,r+=8),0!=(e=t>>4)&&(t=e,r+=4),0!=(e=t>>2)&&(t=e,r+=2),0!=(e=t>>1)&&(t=e,r+=1),r}function N(t){this.m=t;}function O(t){this.m=t,this.mp=t.invDigit(),this.mpl=32767&this.mp,this.mph=this.mp>>15,this.um=(1<<t.DB-15)-1,this.mt2=2*t.t;}function j(t,e){return t&e}function H(t,e){return t|e}function M(t,e){return t^e}function K(t,e){return t&~e}function V(t){if(0==t)return -1;var e=0;return 0==(65535&t)&&(t>>=16,e+=16),0==(255&t)&&(t>>=8,e+=8),0==(15&t)&&(t>>=4,e+=4),0==(3&t)&&(t>>=2,e+=2),0==(1&t)&&++e,e}function q(t){for(var e=0;0!=t;)t&=t-1,++e;return e}function J(){}function W(t){return t}function z(t){this.r2=x(),this.q3=x(),E.ONE.dlShiftTo(2*t.t,this.r2),this.mu=this.r2.divide(t),this.m=t;}N.prototype.convert=function Y(t){return t.s<0||t.compareTo(this.m)>=0?t.mod(this.m):t},N.prototype.revert=function G(t){return t},N.prototype.reduce=function X(t){t.divRemTo(this.m,null,t);},N.prototype.mulTo=function Q(t,e,r){t.multiplyTo(e,r),this.reduce(r);},N.prototype.sqrTo=function $(t,e){t.squareTo(e),this.reduce(e);},O.prototype.convert=function Z(t){var e=x();return t.abs().dlShiftTo(this.m.t,e),e.divRemTo(this.m,null,e),t.s<0&&e.compareTo(E.ZERO)>0&&this.m.subTo(e,e),e},O.prototype.revert=function tt(t){var e=x();return t.copyTo(e),this.reduce(e),e},O.prototype.reduce=function et(t){for(;t.t<=this.mt2;)t[t.t++]=0;for(var e=0;e<this.m.t;++e){var r=32767&t[e],n=r*this.mpl+((r*this.mph+(t[e]>>15)*this.mpl&this.um)<<15)&t.DM;for(t[r=e+this.m.t]+=this.m.am(0,n,t,e,0,this.m.t);t[r]>=t.DV;)t[r]-=t.DV,t[++r]++;}t.clamp(),t.drShiftTo(this.m.t,t),t.compareTo(this.m)>=0&&t.subTo(this.m,t);},O.prototype.mulTo=function rt(t,e,r){t.multiplyTo(e,r),this.reduce(r);},O.prototype.sqrTo=function nt(t,e){t.squareTo(e),this.reduce(e);},E.prototype.copyTo=function it(t){for(var e=this.t-1;e>=0;--e)t[e]=this[e];t.t=this.t,t.s=this.s;},E.prototype.fromInt=function ot(t){this.t=1,this.s=t<0?-1:0,t>0?this[0]=t:t<-1?this[0]=t+this.DV:this.t=0;},E.prototype.fromString=function st(t,e){var r;if(16==e)r=4;else if(8==e)r=3;else if(256==e)r=8;else if(2==e)r=1;else if(32==e)r=5;else{if(4!=e)return void this.fromRadix(t,e);r=2;}this.t=0,this.s=0;for(var n=t.length,i=!1,o=0;--n>=0;){var s=8==r?255&t[n]:L(t,n);s<0?"-"==t.charAt(n)&&(i=!0):(i=!1,0==o?this[this.t++]=s:o+r>this.DB?(this[this.t-1]|=(s&(1<<this.DB-o)-1)<<o,this[this.t++]=s>>this.DB-o):this[this.t-1]|=s<<o,(o+=r)>=this.DB&&(o-=this.DB));}8==r&&0!=(128&t[0])&&(this.s=-1,o>0&&(this[this.t-1]|=(1<<this.DB-o)-1<<o)),this.clamp(),i&&E.ZERO.subTo(this,this);},E.prototype.clamp=function at(){for(var t=this.s&this.DM;this.t>0&&this[this.t-1]==t;)--this.t;},E.prototype.dlShiftTo=function ut(t,e){var r;for(r=this.t-1;r>=0;--r)e[r+t]=this[r];for(r=t-1;r>=0;--r)e[r]=0;e.t=this.t+t,e.s=this.s;},E.prototype.drShiftTo=function ct(t,e){for(var r=t;r<this.t;++r)e[r-t]=this[r];e.t=Math.max(this.t-t,0),e.s=this.s;},E.prototype.lShiftTo=function ht(t,e){var r,n=t%this.DB,i=this.DB-n,o=(1<<i)-1,s=Math.floor(t/this.DB),a=this.s<<n&this.DM;for(r=this.t-1;r>=0;--r)e[r+s+1]=this[r]>>i|a,a=(this[r]&o)<<n;for(r=s-1;r>=0;--r)e[r]=0;e[s]=a,e.t=this.t+s+1,e.s=this.s,e.clamp();},E.prototype.rShiftTo=function lt(t,e){e.s=this.s;var r=Math.floor(t/this.DB);if(r>=this.t)e.t=0;else{var n=t%this.DB,i=this.DB-n,o=(1<<n)-1;e[0]=this[r]>>n;for(var s=r+1;s<this.t;++s)e[s-r-1]|=(this[s]&o)<<i,e[s-r]=this[s]>>n;n>0&&(e[this.t-r-1]|=(this.s&o)<<i),e.t=this.t-r,e.clamp();}},E.prototype.subTo=function ft(t,e){for(var r=0,n=0,i=Math.min(t.t,this.t);r<i;)n+=this[r]-t[r],e[r++]=n&this.DM,n>>=this.DB;if(t.t<this.t){for(n-=t.s;r<this.t;)n+=this[r],e[r++]=n&this.DM,n>>=this.DB;n+=this.s;}else{for(n+=this.s;r<t.t;)n-=t[r],e[r++]=n&this.DM,n>>=this.DB;n-=t.s;}e.s=n<0?-1:0,n<-1?e[r++]=this.DV+n:n>0&&(e[r++]=n),e.t=r,e.clamp();},E.prototype.multiplyTo=function dt(t,e){var r=this.abs(),n=t.abs(),i=r.t;for(e.t=i+n.t;--i>=0;)e[i]=0;for(i=0;i<n.t;++i)e[i+r.t]=r.am(0,n[i],e,i,0,r.t);e.s=0,e.clamp(),this.s!=t.s&&E.ZERO.subTo(e,e);},E.prototype.squareTo=function pt(t){for(var e=this.abs(),r=t.t=2*e.t;--r>=0;)t[r]=0;for(r=0;r<e.t-1;++r){var n=e.am(r,e[r],t,2*r,0,1);(t[r+e.t]+=e.am(r+1,2*e[r],t,2*r+1,n,e.t-r-1))>=e.DV&&(t[r+e.t]-=e.DV,t[r+e.t+1]=1);}t.t>0&&(t[t.t-1]+=e.am(r,e[r],t,2*r,0,1)),t.s=0,t.clamp();},E.prototype.divRemTo=function gt(t,e,r){var n=t.abs();if(!(n.t<=0)){var i=this.abs();if(i.t<n.t)return null!=e&&e.fromInt(0),void(null!=r&&this.copyTo(r));null==r&&(r=x());var o=x(),s=this.s,a=t.s,u=this.DB-B(n[n.t-1]);u>0?(n.lShiftTo(u,o),i.lShiftTo(u,r)):(n.copyTo(o),i.copyTo(r));var c=o.t,h=o[c-1];if(0!=h){var l=h*(1<<this.F1)+(c>1?o[c-2]>>this.F2:0),f=this.FV/l,d=(1<<this.F1)/l,p=1<<this.F2,g=r.t,v=g-c,y=null==e?x():e;for(o.dlShiftTo(v,y),r.compareTo(y)>=0&&(r[r.t++]=1,r.subTo(y,r)),E.ONE.dlShiftTo(c,y),y.subTo(o,o);o.t<c;)o[o.t++]=0;for(;--v>=0;){var m=r[--g]==h?this.DM:Math.floor(r[g]*f+(r[g-1]+p)*d);if((r[g]+=o.am(0,m,r,v,0,c))<m)for(o.dlShiftTo(v,y),r.subTo(y,r);r[g]<--m;)r.subTo(y,r);}null!=e&&(r.drShiftTo(c,e),s!=a&&E.ZERO.subTo(e,e)),r.t=c,r.clamp(),u>0&&r.rShiftTo(u,r),s<0&&E.ZERO.subTo(r,r);}}},E.prototype.invDigit=function vt(){if(this.t<1)return 0;var t=this[0];if(0==(1&t))return 0;var e=3&t;return (e=(e=(e=(e=e*(2-(15&t)*e)&15)*(2-(255&t)*e)&255)*(2-((65535&t)*e&65535))&65535)*(2-t*e%this.DV)%this.DV)>0?this.DV-e:-e},E.prototype.isEven=function yt(){return 0==(this.t>0?1&this[0]:this.s)},E.prototype.exp=function mt(t,e){if(t>4294967295||t<1)return E.ONE;var r=x(),n=x(),i=e.convert(this),o=B(t)-1;for(i.copyTo(r);--o>=0;)if(e.sqrTo(r,n),(t&1<<o)>0)e.mulTo(n,i,r);else{var s=r;r=n,n=s;}return e.revert(r)},E.prototype.toString=function _t(t){if(this.s<0)return "-"+this.negate().toString(t);var e;if(16==t)e=4;else if(8==t)e=3;else if(2==t)e=1;else if(32==t)e=5;else{if(4!=t)return this.toRadix(t);e=2;}var r,n=(1<<e)-1,i=!1,o="",s=this.t,a=this.DB-s*this.DB%e;if(s-- >0)for(a<this.DB&&(r=this[s]>>a)>0&&(i=!0,o=D(r));s>=0;)a<e?(r=(this[s]&(1<<a)-1)<<e-a,r|=this[--s]>>(a+=this.DB-e)):(r=this[s]>>(a-=e)&n,a<=0&&(a+=this.DB,--s)),r>0&&(i=!0),i&&(o+=D(r));return i?o:"0"},E.prototype.negate=function St(){var t=x();return E.ZERO.subTo(this,t),t},E.prototype.abs=function Ft(){return this.s<0?this.negate():this},E.prototype.compareTo=function bt(t){var e=this.s-t.s;if(0!=e)return e;var r=this.t;if(0!=(e=r-t.t))return this.s<0?-e:e;for(;--r>=0;)if(0!=(e=this[r]-t[r]))return e;return 0},E.prototype.bitLength=function wt(){return this.t<=0?0:this.DB*(this.t-1)+B(this[this.t-1]^this.s&this.DM)},E.prototype.mod=function Et(t){var e=x();return this.abs().divRemTo(t,null,e),this.s<0&&e.compareTo(E.ZERO)>0&&t.subTo(e,e),e},E.prototype.modPowInt=function xt(t,e){var r;return r=t<256||e.isEven()?new N(e):new O(e),this.exp(t,r)},E.ZERO=U(0),E.ONE=U(1),J.prototype.convert=W,J.prototype.revert=W,J.prototype.mulTo=function kt(t,e,r){t.multiplyTo(e,r);},J.prototype.sqrTo=function At(t,e){t.squareTo(e);},z.prototype.convert=function Pt(t){if(t.s<0||t.t>2*this.m.t)return t.mod(this.m);if(t.compareTo(this.m)<0)return t;var e=x();return t.copyTo(e),this.reduce(e),e},z.prototype.revert=function Ct(t){return t},z.prototype.reduce=function Tt(t){for(t.drShiftTo(this.m.t-1,this.r2),t.t>this.m.t+1&&(t.t=this.m.t+1,t.clamp()),this.mu.multiplyUpperTo(this.r2,this.m.t+1,this.q3),this.m.multiplyLowerTo(this.q3,this.m.t+1,this.r2);t.compareTo(this.r2)<0;)t.dAddOffset(1,this.m.t+1);for(t.subTo(this.r2,t);t.compareTo(this.m)>=0;)t.subTo(this.m,t);},z.prototype.mulTo=function Rt(t,e,r){t.multiplyTo(e,r),this.reduce(r);},z.prototype.sqrTo=function It(t,e){t.squareTo(e),this.reduce(e);};var Dt=[2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97,101,103,107,109,113,127,131,137,139,149,151,157,163,167,173,179,181,191,193,197,199,211,223,227,229,233,239,241,251,257,263,269,271,277,281,283,293,307,311,313,317,331,337,347,349,353,359,367,373,379,383,389,397,401,409,419,421,431,433,439,443,449,457,461,463,467,479,487,491,499,503,509,521,523,541,547,557,563,569,571,577,587,593,599,601,607,613,617,619,631,641,643,647,653,659,661,673,677,683,691,701,709,719,727,733,739,743,751,757,761,769,773,787,797,809,811,821,823,827,829,839,853,857,859,863,877,881,883,887,907,911,919,929,937,941,947,953,967,971,977,983,991,997],Lt=(1<<26)/Dt[Dt.length-1];
    /*! (c) Tom Wu | http://www-cs-students.stanford.edu/~tjw/jsbn/
     */
    function Ut(){this.i=0,this.j=0,this.S=new Array;}E.prototype.chunkSize=function Bt(t){return Math.floor(Math.LN2*this.DB/Math.log(t))},E.prototype.toRadix=function Nt(t){if(null==t&&(t=10),0==this.signum()||t<2||t>36)return "0";var e=this.chunkSize(t),r=Math.pow(t,e),n=U(r),i=x(),o=x(),s="";for(this.divRemTo(n,i,o);i.signum()>0;)s=(r+o.intValue()).toString(t).substr(1)+s,i.divRemTo(n,i,o);return o.intValue().toString(t)+s},E.prototype.fromRadix=function Ot(t,e){this.fromInt(0),null==e&&(e=10);for(var r=this.chunkSize(e),n=Math.pow(e,r),i=!1,o=0,s=0,a=0;a<t.length;++a){var u=L(t,a);u<0?"-"==t.charAt(a)&&0==this.signum()&&(i=!0):(s=e*s+u,++o>=r&&(this.dMultiply(n),this.dAddOffset(s,0),o=0,s=0));}o>0&&(this.dMultiply(Math.pow(e,o)),this.dAddOffset(s,0)),i&&E.ZERO.subTo(this,this);},E.prototype.fromNumber=function jt(t,e,r){if("number"==typeof e)if(t<2)this.fromInt(1);else for(this.fromNumber(t,r),this.testBit(t-1)||this.bitwiseTo(E.ONE.shiftLeft(t-1),H,this),this.isEven()&&this.dAddOffset(1,0);!this.isProbablePrime(e);)this.dAddOffset(2,0),this.bitLength()>t&&this.subTo(E.ONE.shiftLeft(t-1),this);else{var n=new Array,i=7&t;n.length=1+(t>>3),e.nextBytes(n),i>0?n[0]&=(1<<i)-1:n[0]=0,this.fromString(n,256);}},E.prototype.bitwiseTo=function Ht(t,e,r){var n,i,o=Math.min(t.t,this.t);for(n=0;n<o;++n)r[n]=e(this[n],t[n]);if(t.t<this.t){for(i=t.s&this.DM,n=o;n<this.t;++n)r[n]=e(this[n],i);r.t=this.t;}else{for(i=this.s&this.DM,n=o;n<t.t;++n)r[n]=e(i,t[n]);r.t=t.t;}r.s=e(this.s,t.s),r.clamp();},E.prototype.changeBit=function Mt(t,e){var r=E.ONE.shiftLeft(t);return this.bitwiseTo(r,e,r),r},E.prototype.addTo=function Kt(t,e){for(var r=0,n=0,i=Math.min(t.t,this.t);r<i;)n+=this[r]+t[r],e[r++]=n&this.DM,n>>=this.DB;if(t.t<this.t){for(n+=t.s;r<this.t;)n+=this[r],e[r++]=n&this.DM,n>>=this.DB;n+=this.s;}else{for(n+=this.s;r<t.t;)n+=t[r],e[r++]=n&this.DM,n>>=this.DB;n+=t.s;}e.s=n<0?-1:0,n>0?e[r++]=n:n<-1&&(e[r++]=this.DV+n),e.t=r,e.clamp();},E.prototype.dMultiply=function Vt(t){this[this.t]=this.am(0,t-1,this,0,0,this.t),++this.t,this.clamp();},E.prototype.dAddOffset=function qt(t,e){if(0!=t){for(;this.t<=e;)this[this.t++]=0;for(this[e]+=t;this[e]>=this.DV;)this[e]-=this.DV,++e>=this.t&&(this[this.t++]=0),++this[e];}},E.prototype.multiplyLowerTo=function Jt(t,e,r){var n,i=Math.min(this.t+t.t,e);for(r.s=0,r.t=i;i>0;)r[--i]=0;for(n=r.t-this.t;i<n;++i)r[i+this.t]=this.am(0,t[i],r,i,0,this.t);for(n=Math.min(t.t,e);i<n;++i)this.am(0,t[i],r,i,0,e-i);r.clamp();},E.prototype.multiplyUpperTo=function Wt(t,e,r){--e;var n=r.t=this.t+t.t-e;for(r.s=0;--n>=0;)r[n]=0;for(n=Math.max(e-this.t,0);n<t.t;++n)r[this.t+n-e]=this.am(e-n,t[n],r,0,0,this.t+n-e);r.clamp(),r.drShiftTo(1,r);},E.prototype.modInt=function zt(t){if(t<=0)return 0;var e=this.DV%t,r=this.s<0?t-1:0;if(this.t>0)if(0==e)r=this[0]%t;else for(var n=this.t-1;n>=0;--n)r=(e*r+this[n])%t;return r},E.prototype.millerRabin=function Yt(t){var e=this.subtract(E.ONE),r=e.getLowestSetBit();if(r<=0)return !1;var n=e.shiftRight(r);(t=t+1>>1)>Dt.length&&(t=Dt.length);for(var i=x(),o=0;o<t;++o){i.fromInt(Dt[Math.floor(Math.random()*Dt.length)]);var s=i.modPow(n,this);if(0!=s.compareTo(E.ONE)&&0!=s.compareTo(e)){for(var a=1;a++<r&&0!=s.compareTo(e);)if(0==(s=s.modPowInt(2,this)).compareTo(E.ONE))return !1;if(0!=s.compareTo(e))return !1}}return !0},E.prototype.clone=
    /*! (c) Tom Wu | http://www-cs-students.stanford.edu/~tjw/jsbn/
     */
    function Gt(){var t=x();return this.copyTo(t),t},E.prototype.intValue=function Xt(){if(this.s<0){if(1==this.t)return this[0]-this.DV;if(0==this.t)return -1}else{if(1==this.t)return this[0];if(0==this.t)return 0}return (this[1]&(1<<32-this.DB)-1)<<this.DB|this[0]},E.prototype.byteValue=function Qt(){return 0==this.t?this.s:this[0]<<24>>24},E.prototype.shortValue=function $t(){return 0==this.t?this.s:this[0]<<16>>16},E.prototype.signum=function Zt(){return this.s<0?-1:this.t<=0||1==this.t&&this[0]<=0?0:1},E.prototype.toByteArray=function te(){var t=this.t,e=new Array;e[0]=this.s;var r,n=this.DB-t*this.DB%8,i=0;if(t-- >0)for(n<this.DB&&(r=this[t]>>n)!=(this.s&this.DM)>>n&&(e[i++]=r|this.s<<this.DB-n);t>=0;)n<8?(r=(this[t]&(1<<n)-1)<<8-n,r|=this[--t]>>(n+=this.DB-8)):(r=this[t]>>(n-=8)&255,n<=0&&(n+=this.DB,--t)),0!=(128&r)&&(r|=-256),0==i&&(128&this.s)!=(128&r)&&++i,(i>0||r!=this.s)&&(e[i++]=r);return e},E.prototype.equals=function ee(t){return 0==this.compareTo(t)},E.prototype.min=function re(t){return this.compareTo(t)<0?this:t},E.prototype.max=function ne(t){return this.compareTo(t)>0?this:t},E.prototype.and=function ie(t){var e=x();return this.bitwiseTo(t,j,e),e},E.prototype.or=function oe(t){var e=x();return this.bitwiseTo(t,H,e),e},E.prototype.xor=function se(t){var e=x();return this.bitwiseTo(t,M,e),e},E.prototype.andNot=function ae(t){var e=x();return this.bitwiseTo(t,K,e),e},E.prototype.not=function ue(){for(var t=x(),e=0;e<this.t;++e)t[e]=this.DM&~this[e];return t.t=this.t,t.s=~this.s,t},E.prototype.shiftLeft=function ce(t){var e=x();return t<0?this.rShiftTo(-t,e):this.lShiftTo(t,e),e},E.prototype.shiftRight=function he(t){var e=x();return t<0?this.lShiftTo(-t,e):this.rShiftTo(t,e),e},E.prototype.getLowestSetBit=function le(){for(var t=0;t<this.t;++t)if(0!=this[t])return t*this.DB+V(this[t]);return this.s<0?this.t*this.DB:-1},E.prototype.bitCount=function fe(){for(var t=0,e=this.s&this.DM,r=0;r<this.t;++r)t+=q(this[r]^e);return t},E.prototype.testBit=function de(t){var e=Math.floor(t/this.DB);return e>=this.t?0!=this.s:0!=(this[e]&1<<t%this.DB)},E.prototype.setBit=function pe(t){return this.changeBit(t,H)},E.prototype.clearBit=function ge(t){return this.changeBit(t,K)},E.prototype.flipBit=function ve(t){return this.changeBit(t,M)},E.prototype.add=function ye(t){var e=x();return this.addTo(t,e),e},E.prototype.subtract=function me(t){var e=x();return this.subTo(t,e),e},E.prototype.multiply=function _e(t){var e=x();return this.multiplyTo(t,e),e},E.prototype.divide=function Se(t){var e=x();return this.divRemTo(t,e,null),e},E.prototype.remainder=function Fe(t){var e=x();return this.divRemTo(t,null,e),e},E.prototype.divideAndRemainder=function be(t){var e=x(),r=x();return this.divRemTo(t,e,r),new Array(e,r)},E.prototype.modPow=function we(t,e){var r,n,i=t.bitLength(),o=U(1);if(i<=0)return o;r=i<18?1:i<48?3:i<144?4:i<768?5:6,n=i<8?new N(e):e.isEven()?new z(e):new O(e);var s=new Array,a=3,u=r-1,c=(1<<r)-1;if(s[1]=n.convert(this),r>1){var h=x();for(n.sqrTo(s[1],h);a<=c;)s[a]=x(),n.mulTo(h,s[a-2],s[a]),a+=2;}var l,f,d=t.t-1,p=!0,g=x();for(i=B(t[d])-1;d>=0;){for(i>=u?l=t[d]>>i-u&c:(l=(t[d]&(1<<i+1)-1)<<u-i,d>0&&(l|=t[d-1]>>this.DB+i-u)),a=r;0==(1&l);)l>>=1,--a;if((i-=a)<0&&(i+=this.DB,--d),p)s[l].copyTo(o),p=!1;else{for(;a>1;)n.sqrTo(o,g),n.sqrTo(g,o),a-=2;a>0?n.sqrTo(o,g):(f=o,o=g,g=f),n.mulTo(g,s[l],o);}for(;d>=0&&0==(t[d]&1<<i);)n.sqrTo(o,g),f=o,o=g,g=f,--i<0&&(i=this.DB-1,--d);}return n.revert(o)},E.prototype.modInverse=function Ee(t){var e=t.isEven();if(this.isEven()&&e||0==t.signum())return E.ZERO;for(var r=t.clone(),n=this.clone(),i=U(1),o=U(0),s=U(0),a=U(1);0!=r.signum();){for(;r.isEven();)r.rShiftTo(1,r),e?(i.isEven()&&o.isEven()||(i.addTo(this,i),o.subTo(t,o)),i.rShiftTo(1,i)):o.isEven()||o.subTo(t,o),o.rShiftTo(1,o);for(;n.isEven();)n.rShiftTo(1,n),e?(s.isEven()&&a.isEven()||(s.addTo(this,s),a.subTo(t,a)),s.rShiftTo(1,s)):a.isEven()||a.subTo(t,a),a.rShiftTo(1,a);r.compareTo(n)>=0?(r.subTo(n,r),e&&i.subTo(s,i),o.subTo(a,o)):(n.subTo(r,n),e&&s.subTo(i,s),a.subTo(o,a));}return 0!=n.compareTo(E.ONE)?E.ZERO:a.compareTo(t)>=0?a.subtract(t):a.signum()<0?(a.addTo(t,a),a.signum()<0?a.add(t):a):a},E.prototype.pow=function xe(t){return this.exp(t,new J)},E.prototype.gcd=function ke(t){var e=this.s<0?this.negate():this.clone(),r=t.s<0?t.negate():t.clone();if(e.compareTo(r)<0){var n=e;e=r,r=n;}var i=e.getLowestSetBit(),o=r.getLowestSetBit();if(o<0)return e;for(i<o&&(o=i),o>0&&(e.rShiftTo(o,e),r.rShiftTo(o,r));e.signum()>0;)(i=e.getLowestSetBit())>0&&e.rShiftTo(i,e),(i=r.getLowestSetBit())>0&&r.rShiftTo(i,r),e.compareTo(r)>=0?(e.subTo(r,e),e.rShiftTo(1,e)):(r.subTo(e,r),r.rShiftTo(1,r));return o>0&&r.lShiftTo(o,r),r},E.prototype.isProbablePrime=function Ae(t){var e,r=this.abs();if(1==r.t&&r[0]<=Dt[Dt.length-1]){for(e=0;e<Dt.length;++e)if(r[0]==Dt[e])return !0;return !1}if(r.isEven())return !1;for(e=1;e<Dt.length;){for(var n=Dt[e],i=e+1;i<Dt.length&&n<Lt;)n*=Dt[i++];for(n=r.modInt(n);e<i;)if(n%Dt[e++]==0)return !1}return r.millerRabin(t)},E.prototype.square=function Pe(){var t=x();return this.squareTo(t),t},Ut.prototype.init=function Ce(t){var e,r,n;for(e=0;e<256;++e)this.S[e]=e;for(r=0,e=0;e<256;++e)r=r+this.S[e]+t[e%t.length]&255,n=this.S[e],this.S[e]=this.S[r],this.S[r]=n;this.i=0,this.j=0;},Ut.prototype.next=function Te(){var t;return this.i=this.i+1&255,this.j=this.j+this.S[this.i]&255,t=this.S[this.i],this.S[this.i]=this.S[this.j],this.S[this.j]=t,this.S[t+this.S[this.i]&255]};var Re,Ie,De,Le=256;
    /*! (c) Tom Wu | http://www-cs-students.stanford.edu/~tjw/jsbn/
     */function Ue(){!function t(e){Ie[De++]^=255&e,Ie[De++]^=e>>8&255,Ie[De++]^=e>>16&255,Ie[De++]^=e>>24&255,De>=Le&&(De-=Le);}((new Date).getTime());}if(null==Ie){var Be;if(Ie=new Array,De=0,void 0!==i&&(void 0!==i.msCrypto)){var Ne=i.msCrypto;if(Ne.getRandomValues){var Oe=new Uint8Array(32);for(Ne.getRandomValues(Oe),Be=0;Be<32;++Be)Ie[De++]=Oe[Be];}}for(;De<Le;)Be=Math.floor(65536*Math.random()),Ie[De++]=Be>>>8,Ie[De++]=255&Be;De=0,Ue();}function He(){if(null==Re){for(Ue(),(Re=function t(){return new Ut}()).init(Ie),De=0;De<Ie.length;++De)Ie[De]=0;De=0;}return Re.next()}function Me(){}
    /*! (c) Tom Wu | http://www-cs-students.stanford.edu/~tjw/jsbn/
     */
    function Ke(t,e){return new E(t,e)}function Ve(t,e,r){for(var n="",i=0;n.length<e;)n+=r(String.fromCharCode.apply(String,t.concat([(4278190080&i)>>24,(16711680&i)>>16,(65280&i)>>8,255&i]))),i+=1;return n}function qe(){this.n=null,this.e=0,this.d=null,this.p=null,this.q=null,this.dmp1=null,this.dmq1=null,this.coeff=null;}
    /*! (c) Tom Wu | http://www-cs-students.stanford.edu/~tjw/jsbn/
     */
    function Je(t,e){this.x=e,this.q=t;}function We(t,e,r,n){this.curve=t,this.x=e,this.y=r,this.z=null==n?E.ONE:n,this.zinv=null;}function ze(t,e,r){this.q=t,this.a=this.fromBigInteger(e),this.b=this.fromBigInteger(r),this.infinity=new We(this,null,null);}Me.prototype.nextBytes=function Ye(t){var e;for(e=0;e<t.length;++e)t[e]=He();},qe.prototype.doPublic=function Ge(t){return t.modPowInt(this.e,this.n)},qe.prototype.setPublic=function Xe(t,e){if(this.isPublic=!0,this.isPrivate=!1,"string"!=typeof t)this.n=t,this.e=e;else{if(!(null!=t&&null!=e&&t.length>0&&e.length>0))throw "Invalid RSA public key";this.n=Ke(t,16),this.e=parseInt(e,16);}},qe.prototype.encrypt=function Qe(t){var e=function r(t,e){if(e<t.length+11)throw "Message too long for RSA";for(var r=new Array,n=t.length-1;n>=0&&e>0;){var i=t.charCodeAt(n--);i<128?r[--e]=i:i>127&&i<2048?(r[--e]=63&i|128,r[--e]=i>>6|192):(r[--e]=63&i|128,r[--e]=i>>6&63|128,r[--e]=i>>12|224);}r[--e]=0;for(var o=new Me,s=new Array;e>2;){for(s[0]=0;0==s[0];)o.nextBytes(s);r[--e]=s[0];}return r[--e]=2,r[--e]=0,new E(r)}(t,this.n.bitLength()+7>>3);if(null==e)return null;var n=this.doPublic(e);if(null==n)return null;var i=n.toString(16);return 0==(1&i.length)?i:"0"+i},qe.prototype.encryptOAEP=function $e(t,e,r){var n=function i(t,e,r,n){var i=Er.crypto.MessageDigest,o=Er.crypto.Util,s=null;if(r||(r="sha1"),"string"==typeof r&&(s=i.getCanonicalAlgName(r),n=i.getHashLength(s),r=function t(e){return Or(o.hashHex(jr(e),s))}),t.length+2*n+2>e)throw "Message too long for RSA";var a,u="";for(a=0;a<e-t.length-2*n-2;a+=1)u+="\0";var c=r("")+u+""+t,h=new Array(n);(new Me).nextBytes(h);var l=Ve(h,c.length,r),f=[];for(a=0;a<c.length;a+=1)f[a]=c.charCodeAt(a)^l.charCodeAt(a);var d=Ve(f,h.length,r),p=[0];for(a=0;a<h.length;a+=1)p[a+1]=h[a]^d.charCodeAt(a);return new E(p.concat(f))}(t,this.n.bitLength()+7>>3,e,r);if(null==n)return null;var o=this.doPublic(n);if(null==o)return null;var s=o.toString(16);return 0==(1&s.length)?s:"0"+s},qe.prototype.type="RSA",Je.prototype.equals=function Ze(t){return t==this||this.q.equals(t.q)&&this.x.equals(t.x)},Je.prototype.toBigInteger=function tr(){return this.x},Je.prototype.negate=function er(){return new Je(this.q,this.x.negate().mod(this.q))},Je.prototype.add=function rr(t){return new Je(this.q,this.x.add(t.toBigInteger()).mod(this.q))},Je.prototype.subtract=function nr(t){return new Je(this.q,this.x.subtract(t.toBigInteger()).mod(this.q))},Je.prototype.multiply=function ir(t){return new Je(this.q,this.x.multiply(t.toBigInteger()).mod(this.q))},Je.prototype.square=function or(){return new Je(this.q,this.x.square().mod(this.q))},Je.prototype.divide=function sr(t){return new Je(this.q,this.x.multiply(t.toBigInteger().modInverse(this.q)).mod(this.q))},We.prototype.getX=function ar(){return null==this.zinv&&(this.zinv=this.z.modInverse(this.curve.q)),this.curve.fromBigInteger(this.x.toBigInteger().multiply(this.zinv).mod(this.curve.q))},We.prototype.getY=function ur(){return null==this.zinv&&(this.zinv=this.z.modInverse(this.curve.q)),this.curve.fromBigInteger(this.y.toBigInteger().multiply(this.zinv).mod(this.curve.q))},We.prototype.equals=function cr(t){return t==this||(this.isInfinity()?t.isInfinity():t.isInfinity()?this.isInfinity():!!t.y.toBigInteger().multiply(this.z).subtract(this.y.toBigInteger().multiply(t.z)).mod(this.curve.q).equals(E.ZERO)&&t.x.toBigInteger().multiply(this.z).subtract(this.x.toBigInteger().multiply(t.z)).mod(this.curve.q).equals(E.ZERO))},We.prototype.isInfinity=function hr(){return null==this.x&&null==this.y||this.z.equals(E.ZERO)&&!this.y.toBigInteger().equals(E.ZERO)},We.prototype.negate=function lr(){return new We(this.curve,this.x,this.y.negate(),this.z)},We.prototype.add=function fr(t){if(this.isInfinity())return t;if(t.isInfinity())return this;var e=t.y.toBigInteger().multiply(this.z).subtract(this.y.toBigInteger().multiply(t.z)).mod(this.curve.q),r=t.x.toBigInteger().multiply(this.z).subtract(this.x.toBigInteger().multiply(t.z)).mod(this.curve.q);if(E.ZERO.equals(r))return E.ZERO.equals(e)?this.twice():this.curve.getInfinity();var n=new E("3"),i=this.x.toBigInteger(),o=this.y.toBigInteger(),s=(t.x.toBigInteger(),t.y.toBigInteger(),r.square()),a=s.multiply(r),u=i.multiply(s),c=e.square().multiply(this.z),h=c.subtract(u.shiftLeft(1)).multiply(t.z).subtract(a).multiply(r).mod(this.curve.q),l=u.multiply(n).multiply(e).subtract(o.multiply(a)).subtract(c.multiply(e)).multiply(t.z).add(e.multiply(a)).mod(this.curve.q),f=a.multiply(this.z).multiply(t.z).mod(this.curve.q);return new We(this.curve,this.curve.fromBigInteger(h),this.curve.fromBigInteger(l),f)},We.prototype.twice=function dr(){if(this.isInfinity())return this;if(0==this.y.toBigInteger().signum())return this.curve.getInfinity();var t=new E("3"),e=this.x.toBigInteger(),r=this.y.toBigInteger(),n=r.multiply(this.z),i=n.multiply(r).mod(this.curve.q),o=this.curve.a.toBigInteger(),s=e.square().multiply(t);E.ZERO.equals(o)||(s=s.add(this.z.square().multiply(o)));var a=(s=s.mod(this.curve.q)).square().subtract(e.shiftLeft(3).multiply(i)).shiftLeft(1).multiply(n).mod(this.curve.q),u=s.multiply(t).multiply(e).subtract(i.shiftLeft(1)).shiftLeft(2).multiply(i).subtract(s.square().multiply(s)).mod(this.curve.q),c=n.square().multiply(n).shiftLeft(3).mod(this.curve.q);return new We(this.curve,this.curve.fromBigInteger(a),this.curve.fromBigInteger(u),c)},We.prototype.multiply=function pr(t){if(this.isInfinity())return this;if(0==t.signum())return this.curve.getInfinity();var e,r=t,n=r.multiply(new E("3")),i=this.negate(),o=this;for(e=n.bitLength()-2;e>0;--e){o=o.twice();var s=n.testBit(e);s!=r.testBit(e)&&(o=o.add(s?this:i));}return o},We.prototype.multiplyTwo=function gr(t,e,r){var n;n=t.bitLength()>r.bitLength()?t.bitLength()-1:r.bitLength()-1;for(var i=this.curve.getInfinity(),o=this.add(e);n>=0;)i=i.twice(),t.testBit(n)?i=r.testBit(n)?i.add(o):i.add(this):r.testBit(n)&&(i=i.add(e)),--n;return i},ze.prototype.getQ=function vr(){return this.q},ze.prototype.getA=function yr(){return this.a},ze.prototype.getB=function mr(){return this.b},ze.prototype.equals=function _r(t){return t==this||this.q.equals(t.q)&&this.a.equals(t.a)&&this.b.equals(t.b)},ze.prototype.getInfinity=function Sr(){return this.infinity},ze.prototype.fromBigInteger=function Fr(t){return new Je(this.q,t)},ze.prototype.decodePointHex=function br(t){switch(parseInt(t.substr(0,2),16)){case 0:return this.infinity;case 2:case 3:return null;case 4:case 6:case 7:var e=(t.length-2)/2,r=t.substr(2,e),n=t.substr(e+2,e);return new We(this,this.fromBigInteger(new E(r,16)),this.fromBigInteger(new E(n,16)));default:return null}},
    /*! (c) Stefan Thomas | https://github.com/bitcoinjs/bitcoinjs-lib
     */
    Je.prototype.getByteLength=function(){return Math.floor((this.toBigInteger().bitLength()+7)/8)},We.prototype.getEncoded=function(t){var e=function t(e,r){var n=e.toByteArrayUnsigned();if(r<n.length)n=n.slice(n.length-r);else for(;r>n.length;)n.unshift(0);return n},r=this.getX().toBigInteger(),n=this.getY().toBigInteger(),i=e(r,32);return t?n.isEven()?i.unshift(2):i.unshift(3):(i.unshift(4),i=i.concat(e(n,32))),i},We.decodeFrom=function(t,e){e[0];var r=e.length-1,n=e.slice(1,1+r/2),i=e.slice(1+r/2,1+r);n.unshift(0),i.unshift(0);var o=new E(n),s=new E(i);return new We(t,t.fromBigInteger(o),t.fromBigInteger(s))},We.decodeFromHex=function(t,e){e.substr(0,2);var r=e.length-2,n=e.substr(2,r/2),i=e.substr(2+r/2,r/2),o=new E(n,16),s=new E(i,16);return new We(t,t.fromBigInteger(o),t.fromBigInteger(s))},We.prototype.add2D=function(t){if(this.isInfinity())return t;if(t.isInfinity())return this;if(this.x.equals(t.x))return this.y.equals(t.y)?this.twice():this.curve.getInfinity();var e=t.x.subtract(this.x),r=t.y.subtract(this.y).divide(e),n=r.square().subtract(this.x).subtract(t.x),i=r.multiply(this.x.subtract(n)).subtract(this.y);return new We(this.curve,n,i)},We.prototype.twice2D=function(){if(this.isInfinity())return this;if(0==this.y.toBigInteger().signum())return this.curve.getInfinity();var t=this.curve.fromBigInteger(E.valueOf(2)),e=this.curve.fromBigInteger(E.valueOf(3)),r=this.x.square().multiply(e).add(this.curve.a).divide(this.y.multiply(t)),n=r.square().subtract(this.x.multiply(t)),i=r.multiply(this.x.subtract(n)).subtract(this.y);return new We(this.curve,n,i)},We.prototype.multiply2D=function(t){if(this.isInfinity())return this;if(0==t.signum())return this.curve.getInfinity();var e,r=t,n=r.multiply(new E("3")),i=this.negate(),o=this;for(e=n.bitLength()-2;e>0;--e){o=o.twice();var s=n.testBit(e);s!=r.testBit(e)&&(o=o.add2D(s?this:i));}return o},We.prototype.isOnCurve=function(){var t=this.getX().toBigInteger(),e=this.getY().toBigInteger(),r=this.curve.getA().toBigInteger(),n=this.curve.getB().toBigInteger(),i=this.curve.getQ(),o=e.multiply(e).mod(i),s=t.multiply(t).multiply(t).add(r.multiply(t)).add(n).mod(i);return o.equals(s)},We.prototype.toString=function(){return "("+this.getX().toBigInteger().toString()+","+this.getY().toBigInteger().toString()+")"},We.prototype.validate=function(){var t=this.curve.getQ();if(this.isInfinity())throw new Error("Point is at infinity.");var e=this.getX().toBigInteger(),r=this.getY().toBigInteger();if(e.compareTo(E.ONE)<0||e.compareTo(t.subtract(E.ONE))>0)throw new Error("x coordinate out of bounds");if(r.compareTo(E.ONE)<0||r.compareTo(t.subtract(E.ONE))>0)throw new Error("y coordinate out of bounds");if(!this.isOnCurve())throw new Error("Point is not on the curve.");if(this.multiply(t).isInfinity())throw new Error("Point is not a scalar multiple of G.");return !0};
    /*! Mike Samuel (c) 2009 | code.google.com/p/json-sans-eval
     */
    var wr=function(){var t=new RegExp('(?:false|true|null|[\\{\\}\\[\\]]|(?:-?\\b(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\\b)|(?:"(?:[^\\0-\\x08\\x0a-\\x1f"\\\\]|\\\\(?:["/\\\\bfnrt]|u[0-9A-Fa-f]{4}))*"))',"g"),e=new RegExp("\\\\(?:([^u])|u(.{4}))","g"),n={'"':'"',"/":"/","\\":"\\",b:"\b",f:"\f",n:"\n",r:"\r",t:"\t"};function i(t,e,r){return e?n[e]:String.fromCharCode(parseInt(r,16))}var o=new String(""),s=(Object.hasOwnProperty);return function(n,a){var u,c,h=n.match(t),l=h[0],f=!1;"{"===l?u={}:"["===l?u=[]:(u=[],f=!0);for(var d=[u],p=1-f,g=h.length;p<g;++p){var v;switch((l=h[p]).charCodeAt(0)){default:(v=d[0])[c||v.length]=+l,c=void 0;break;case 34:if(-1!==(l=l.substring(1,l.length-1)).indexOf("\\")&&(l=l.replace(e,i)),v=d[0],!c){if(!(v instanceof Array)){c=l||o;break}c=v.length;}v[c]=l,c=void 0;break;case 91:v=d[0],d.unshift(v[c||v.length]=[]),c=void 0;break;case 93:d.shift();break;case 102:(v=d[0])[c||v.length]=!1,c=void 0;break;case 110:(v=d[0])[c||v.length]=null,c=void 0;break;case 116:(v=d[0])[c||v.length]=!0,c=void 0;break;case 123:v=d[0],d.unshift(v[c||v.length]={}),c=void 0;break;case 125:d.shift();}}if(f){if(1!==d.length)throw new Error;u=u[0];}else if(d.length)throw new Error;if(a){u=function t(e,n){var i=e[n];if(i&&"object"===(void 0===i?"undefined":r(i))){var o=null;for(var u in i)if(s.call(i,u)&&i!==e){var c=t(i,u);void 0!==c?i[u]=c:(o||(o=[]),o.push(u));}if(o)for(var h=o.length;--h>=0;)delete i[o[h]];}return a.call(e,n,i)}({"":u},"");}return u}}();void 0!==Er&&Er||(e.KJUR=Er={}),void 0!==Er.asn1&&Er.asn1||(Er.asn1={}),Er.asn1.ASN1Util=new function(){this.integerToByteHex=function(t){var e=t.toString(16);return e.length%2==1&&(e="0"+e),e},this.bigIntToMinTwosComplementsHex=function(t){var e=t.toString(16);if("-"!=e.substr(0,1))e.length%2==1?e="0"+e:e.match(/^[0-7]/)||(e="00"+e);else{var r=e.substr(1).length;r%2==1?r+=1:e.match(/^[0-7]/)||(r+=2);for(var n="",i=0;i<r;i++)n+="f";e=new E(n,16).xor(t).add(E.ONE).toString(16).replace(/^-/,"");}return e},this.getPEMStringFromHex=function(t,e){return Vr(t,e)},this.newObject=function(t){var e=Er.asn1,r=e.DERBoolean,n=e.DERInteger,i=e.DERBitString,o=e.DEROctetString,s=e.DERNull,a=e.DERObjectIdentifier,u=e.DEREnumerated,c=e.DERUTF8String,h=e.DERNumericString,l=e.DERPrintableString,f=e.DERTeletexString,d=e.DERIA5String,p=e.DERUTCTime,g=e.DERGeneralizedTime,v=e.DERSequence,y=e.DERSet,m=e.DERTaggedObject,_=e.ASN1Util.newObject,S=Object.keys(t);if(1!=S.length)throw "key of param shall be only one.";var F=S[0];if(-1==":bool:int:bitstr:octstr:null:oid:enum:utf8str:numstr:prnstr:telstr:ia5str:utctime:gentime:seq:set:tag:".indexOf(":"+F+":"))throw "undefined key: "+F;if("bool"==F)return new r(t[F]);if("int"==F)return new n(t[F]);if("bitstr"==F)return new i(t[F]);if("octstr"==F)return new o(t[F]);if("null"==F)return new s(t[F]);if("oid"==F)return new a(t[F]);if("enum"==F)return new u(t[F]);if("utf8str"==F)return new c(t[F]);if("numstr"==F)return new h(t[F]);if("prnstr"==F)return new l(t[F]);if("telstr"==F)return new f(t[F]);if("ia5str"==F)return new d(t[F]);if("utctime"==F)return new p(t[F]);if("gentime"==F)return new g(t[F]);if("seq"==F){for(var b=t[F],w=[],E=0;E<b.length;E++){var x=_(b[E]);w.push(x);}return new v({array:w})}if("set"==F){for(b=t[F],w=[],E=0;E<b.length;E++){x=_(b[E]);w.push(x);}return new y({array:w})}if("tag"==F){var k=t[F];if("[object Array]"===Object.prototype.toString.call(k)&&3==k.length){var A=_(k[2]);return new m({tag:k[0],explicit:k[1],obj:A})}var P={};if(void 0!==k.explicit&&(P.explicit=k.explicit),void 0!==k.tag&&(P.tag=k.tag),void 0===k.obj)throw "obj shall be specified for 'tag'.";return P.obj=_(k.obj),new m(P)}},this.jsonToASN1HEX=function(t){return this.newObject(t).getEncodedHex()};},Er.asn1.ASN1Util.oidHexToInt=function(t){for(var e="",r=parseInt(t.substr(0,2),16),n=(e=Math.floor(r/40)+"."+r%40,""),i=2;i<t.length;i+=2){var o=("00000000"+parseInt(t.substr(i,2),16).toString(2)).slice(-8);if(n+=o.substr(1,7),"0"==o.substr(0,1))e=e+"."+new E(n,2).toString(10),n="";}return e},Er.asn1.ASN1Util.oidIntToHex=function(t){var e=function t(e){var r=e.toString(16);return 1==r.length&&(r="0"+r),r},r=function t(r){var n="",i=new E(r,10).toString(2),o=7-i.length%7;7==o&&(o=0);for(var s="",a=0;a<o;a++)s+="0";i=s+i;for(a=0;a<i.length-1;a+=7){var u=i.substr(a,7);a!=i.length-7&&(u="1"+u),n+=e(parseInt(u,2));}return n};if(!t.match(/^[0-9.]+$/))throw "malformed oid string: "+t;var n="",i=t.split("."),o=40*parseInt(i[0])+parseInt(i[1]);n+=e(o),i.splice(0,2);for(var s=0;s<i.length;s++)n+=r(i[s]);return n},Er.asn1.ASN1Object=function(){this.getLengthHexFromValue=function(){if(void 0===this.hV||null==this.hV)throw "this.hV is null or undefined.";if(this.hV.length%2==1)throw "value hex must be even length: n="+"".length+",v="+this.hV;var t=this.hV.length/2,e=t.toString(16);if(e.length%2==1&&(e="0"+e),t<128)return e;var r=e.length/2;if(r>15)throw "ASN.1 length too long to represent by 8x: n = "+t.toString(16);return (128+r).toString(16)+e},this.getEncodedHex=function(){return (null==this.hTLV||this.isModified)&&(this.hV=this.getFreshValueHex(),this.hL=this.getLengthHexFromValue(),this.hTLV=this.hT+this.hL+this.hV,this.isModified=!1),this.hTLV},this.getValueHex=function(){return this.getEncodedHex(),this.hV},this.getFreshValueHex=function(){return ""};},Er.asn1.DERAbstractString=function(t){Er.asn1.DERAbstractString.superclass.constructor.call(this);this.getString=function(){return this.s},this.setString=function(t){this.hTLV=null,this.isModified=!0,this.s=t,this.hV=Br(this.s).toLowerCase();},this.setStringHex=function(t){this.hTLV=null,this.isModified=!0,this.s=null,this.hV=t;},this.getFreshValueHex=function(){return this.hV},void 0!==t&&("string"==typeof t?this.setString(t):void 0!==t.str?this.setString(t.str):void 0!==t.hex&&this.setStringHex(t.hex));},o.lang.extend(Er.asn1.DERAbstractString,Er.asn1.ASN1Object),Er.asn1.DERAbstractTime=function(t){Er.asn1.DERAbstractTime.superclass.constructor.call(this);this.localDateToUTC=function(t){return utc=t.getTime()+6e4*t.getTimezoneOffset(),new Date(utc)},this.formatDate=function(t,e,r){var n=this.zeroPadding,i=this.localDateToUTC(t),o=String(i.getFullYear());"utc"==e&&(o=o.substr(2,2));var s=o+n(String(i.getMonth()+1),2)+n(String(i.getDate()),2)+n(String(i.getHours()),2)+n(String(i.getMinutes()),2)+n(String(i.getSeconds()),2);if(!0===r){var a=i.getMilliseconds();if(0!=a){var u=n(String(a),3);s=s+"."+(u=u.replace(/[0]+$/,""));}}return s+"Z"},this.zeroPadding=function(t,e){return t.length>=e?t:new Array(e-t.length+1).join("0")+t},this.getString=function(){return this.s},this.setString=function(t){this.hTLV=null,this.isModified=!0,this.s=t,this.hV=Rr(t);},this.setByDateValue=function(t,e,r,n,i,o){var s=new Date(Date.UTC(t,e-1,r,n,i,o,0));this.setByDate(s);},this.getFreshValueHex=function(){return this.hV};},o.lang.extend(Er.asn1.DERAbstractTime,Er.asn1.ASN1Object),Er.asn1.DERAbstractStructured=function(t){Er.asn1.DERAbstractString.superclass.constructor.call(this);this.setByASN1ObjectArray=function(t){this.hTLV=null,this.isModified=!0,this.asn1Array=t;},this.appendASN1Object=function(t){this.hTLV=null,this.isModified=!0,this.asn1Array.push(t);},this.asn1Array=new Array,void 0!==t&&void 0!==t.array&&(this.asn1Array=t.array);},o.lang.extend(Er.asn1.DERAbstractStructured,Er.asn1.ASN1Object),Er.asn1.DERBoolean=function(){Er.asn1.DERBoolean.superclass.constructor.call(this),this.hT="01",this.hTLV="0101ff";},o.lang.extend(Er.asn1.DERBoolean,Er.asn1.ASN1Object),Er.asn1.DERInteger=function(t){Er.asn1.DERInteger.superclass.constructor.call(this),this.hT="02",this.setByBigInteger=function(t){this.hTLV=null,this.isModified=!0,this.hV=Er.asn1.ASN1Util.bigIntToMinTwosComplementsHex(t);},this.setByInteger=function(t){var e=new E(String(t),10);this.setByBigInteger(e);},this.setValueHex=function(t){this.hV=t;},this.getFreshValueHex=function(){return this.hV},void 0!==t&&(void 0!==t.bigint?this.setByBigInteger(t.bigint):void 0!==t.int?this.setByInteger(t.int):"number"==typeof t?this.setByInteger(t):void 0!==t.hex&&this.setValueHex(t.hex));},o.lang.extend(Er.asn1.DERInteger,Er.asn1.ASN1Object),Er.asn1.DERBitString=function(t){if(void 0!==t&&void 0!==t.obj){var e=Er.asn1.ASN1Util.newObject(t.obj);t.hex="00"+e.getEncodedHex();}Er.asn1.DERBitString.superclass.constructor.call(this),this.hT="03",this.setHexValueIncludingUnusedBits=function(t){this.hTLV=null,this.isModified=!0,this.hV=t;},this.setUnusedBitsAndHexValue=function(t,e){if(t<0||7<t)throw "unused bits shall be from 0 to 7: u = "+t;var r="0"+t;this.hTLV=null,this.isModified=!0,this.hV=r+e;},this.setByBinaryString=function(t){var e=8-(t=t.replace(/0+$/,"")).length%8;8==e&&(e=0);for(var r=0;r<=e;r++)t+="0";var n="";for(r=0;r<t.length-1;r+=8){var i=t.substr(r,8),o=parseInt(i,2).toString(16);1==o.length&&(o="0"+o),n+=o;}this.hTLV=null,this.isModified=!0,this.hV="0"+e+n;},this.setByBooleanArray=function(t){for(var e="",r=0;r<t.length;r++)1==t[r]?e+="1":e+="0";this.setByBinaryString(e);},this.newFalseArray=function(t){for(var e=new Array(t),r=0;r<t;r++)e[r]=!1;return e},this.getFreshValueHex=function(){return this.hV},void 0!==t&&("string"==typeof t&&t.toLowerCase().match(/^[0-9a-f]+$/)?this.setHexValueIncludingUnusedBits(t):void 0!==t.hex?this.setHexValueIncludingUnusedBits(t.hex):void 0!==t.bin?this.setByBinaryString(t.bin):void 0!==t.array&&this.setByBooleanArray(t.array));},o.lang.extend(Er.asn1.DERBitString,Er.asn1.ASN1Object),Er.asn1.DEROctetString=function(t){if(void 0!==t&&void 0!==t.obj){var e=Er.asn1.ASN1Util.newObject(t.obj);t.hex=e.getEncodedHex();}Er.asn1.DEROctetString.superclass.constructor.call(this,t),this.hT="04";},o.lang.extend(Er.asn1.DEROctetString,Er.asn1.DERAbstractString),Er.asn1.DERNull=function(){Er.asn1.DERNull.superclass.constructor.call(this),this.hT="05",this.hTLV="0500";},o.lang.extend(Er.asn1.DERNull,Er.asn1.ASN1Object),Er.asn1.DERObjectIdentifier=function(t){var e=function t(e){var r=e.toString(16);return 1==r.length&&(r="0"+r),r},r=function t(r){var n="",i=new E(r,10).toString(2),o=7-i.length%7;7==o&&(o=0);for(var s="",a=0;a<o;a++)s+="0";i=s+i;for(a=0;a<i.length-1;a+=7){var u=i.substr(a,7);a!=i.length-7&&(u="1"+u),n+=e(parseInt(u,2));}return n};Er.asn1.DERObjectIdentifier.superclass.constructor.call(this),this.hT="06",this.setValueHex=function(t){this.hTLV=null,this.isModified=!0,this.s=null,this.hV=t;},this.setValueOidString=function(t){if(!t.match(/^[0-9.]+$/))throw "malformed oid string: "+t;var n="",i=t.split("."),o=40*parseInt(i[0])+parseInt(i[1]);n+=e(o),i.splice(0,2);for(var s=0;s<i.length;s++)n+=r(i[s]);this.hTLV=null,this.isModified=!0,this.s=null,this.hV=n;},this.setValueName=function(t){var e=Er.asn1.x509.OID.name2oid(t);if(""===e)throw "DERObjectIdentifier oidName undefined: "+t;this.setValueOidString(e);},this.getFreshValueHex=function(){return this.hV},void 0!==t&&("string"==typeof t?t.match(/^[0-2].[0-9.]+$/)?this.setValueOidString(t):this.setValueName(t):void 0!==t.oid?this.setValueOidString(t.oid):void 0!==t.hex?this.setValueHex(t.hex):void 0!==t.name&&this.setValueName(t.name));},o.lang.extend(Er.asn1.DERObjectIdentifier,Er.asn1.ASN1Object),Er.asn1.DEREnumerated=function(t){Er.asn1.DEREnumerated.superclass.constructor.call(this),this.hT="0a",this.setByBigInteger=function(t){this.hTLV=null,this.isModified=!0,this.hV=Er.asn1.ASN1Util.bigIntToMinTwosComplementsHex(t);},this.setByInteger=function(t){var e=new E(String(t),10);this.setByBigInteger(e);},this.setValueHex=function(t){this.hV=t;},this.getFreshValueHex=function(){return this.hV},void 0!==t&&(void 0!==t.int?this.setByInteger(t.int):"number"==typeof t?this.setByInteger(t):void 0!==t.hex&&this.setValueHex(t.hex));},o.lang.extend(Er.asn1.DEREnumerated,Er.asn1.ASN1Object),Er.asn1.DERUTF8String=function(t){Er.asn1.DERUTF8String.superclass.constructor.call(this,t),this.hT="0c";},o.lang.extend(Er.asn1.DERUTF8String,Er.asn1.DERAbstractString),Er.asn1.DERNumericString=function(t){Er.asn1.DERNumericString.superclass.constructor.call(this,t),this.hT="12";},o.lang.extend(Er.asn1.DERNumericString,Er.asn1.DERAbstractString),Er.asn1.DERPrintableString=function(t){Er.asn1.DERPrintableString.superclass.constructor.call(this,t),this.hT="13";},o.lang.extend(Er.asn1.DERPrintableString,Er.asn1.DERAbstractString),Er.asn1.DERTeletexString=function(t){Er.asn1.DERTeletexString.superclass.constructor.call(this,t),this.hT="14";},o.lang.extend(Er.asn1.DERTeletexString,Er.asn1.DERAbstractString),Er.asn1.DERIA5String=function(t){Er.asn1.DERIA5String.superclass.constructor.call(this,t),this.hT="16";},o.lang.extend(Er.asn1.DERIA5String,Er.asn1.DERAbstractString),Er.asn1.DERUTCTime=function(t){Er.asn1.DERUTCTime.superclass.constructor.call(this,t),this.hT="17",this.setByDate=function(t){this.hTLV=null,this.isModified=!0,this.date=t,this.s=this.formatDate(this.date,"utc"),this.hV=Rr(this.s);},this.getFreshValueHex=function(){return void 0===this.date&&void 0===this.s&&(this.date=new Date,this.s=this.formatDate(this.date,"utc"),this.hV=Rr(this.s)),this.hV},void 0!==t&&(void 0!==t.str?this.setString(t.str):"string"==typeof t&&t.match(/^[0-9]{12}Z$/)?this.setString(t):void 0!==t.hex?this.setStringHex(t.hex):void 0!==t.date&&this.setByDate(t.date));},o.lang.extend(Er.asn1.DERUTCTime,Er.asn1.DERAbstractTime),Er.asn1.DERGeneralizedTime=function(t){Er.asn1.DERGeneralizedTime.superclass.constructor.call(this,t),this.hT="18",this.withMillis=!1,this.setByDate=function(t){this.hTLV=null,this.isModified=!0,this.date=t,this.s=this.formatDate(this.date,"gen",this.withMillis),this.hV=Rr(this.s);},this.getFreshValueHex=function(){return void 0===this.date&&void 0===this.s&&(this.date=new Date,this.s=this.formatDate(this.date,"gen",this.withMillis),this.hV=Rr(this.s)),this.hV},void 0!==t&&(void 0!==t.str?this.setString(t.str):"string"==typeof t&&t.match(/^[0-9]{14}Z$/)?this.setString(t):void 0!==t.hex?this.setStringHex(t.hex):void 0!==t.date&&this.setByDate(t.date),!0===t.millis&&(this.withMillis=!0));},o.lang.extend(Er.asn1.DERGeneralizedTime,Er.asn1.DERAbstractTime),Er.asn1.DERSequence=function(t){Er.asn1.DERSequence.superclass.constructor.call(this,t),this.hT="30",this.getFreshValueHex=function(){for(var t="",e=0;e<this.asn1Array.length;e++){t+=this.asn1Array[e].getEncodedHex();}return this.hV=t,this.hV};},o.lang.extend(Er.asn1.DERSequence,Er.asn1.DERAbstractStructured),Er.asn1.DERSet=function(t){Er.asn1.DERSet.superclass.constructor.call(this,t),this.hT="31",this.sortFlag=!0,this.getFreshValueHex=function(){for(var t=new Array,e=0;e<this.asn1Array.length;e++){var r=this.asn1Array[e];t.push(r.getEncodedHex());}return 1==this.sortFlag&&t.sort(),this.hV=t.join(""),this.hV},void 0!==t&&void 0!==t.sortflag&&0==t.sortflag&&(this.sortFlag=!1);},o.lang.extend(Er.asn1.DERSet,Er.asn1.DERAbstractStructured),Er.asn1.DERTaggedObject=function(t){Er.asn1.DERTaggedObject.superclass.constructor.call(this),this.hT="a0",this.hV="",this.isExplicit=!0,this.asn1Object=null,this.setASN1Object=function(t,e,r){this.hT=e,this.isExplicit=t,this.asn1Object=r,this.isExplicit?(this.hV=this.asn1Object.getEncodedHex(),this.hTLV=null,this.isModified=!0):(this.hV=null,this.hTLV=r.getEncodedHex(),this.hTLV=this.hTLV.replace(/^../,e),this.isModified=!1);},this.getFreshValueHex=function(){return this.hV},void 0!==t&&(void 0!==t.tag&&(this.hT=t.tag),void 0!==t.explicit&&(this.isExplicit=t.explicit),void 0!==t.obj&&(this.asn1Object=t.obj,this.setASN1Object(this.isExplicit,this.hT,this.asn1Object)));},o.lang.extend(Er.asn1.DERTaggedObject,Er.asn1.ASN1Object);var Er,xr,kr,Ar=new function(){};function Pr(t){for(var e=new Array,r=0;r<t.length;r++)e[r]=t.charCodeAt(r);return e}function Cr(t){for(var e="",r=0;r<t.length;r++)e+=String.fromCharCode(t[r]);return e}function Tr(t){for(var e="",r=0;r<t.length;r++){var n=t[r].toString(16);1==n.length&&(n="0"+n),e+=n;}return e}function Rr(t){return Tr(Pr(t))}function Ir(t){return t=(t=(t=t.replace(/\=/g,"")).replace(/\+/g,"-")).replace(/\//g,"_")}function Dr(t){return t.length%4==2?t+="==":t.length%4==3&&(t+="="),t=(t=t.replace(/-/g,"+")).replace(/_/g,"/")}function Lr(t){return t.length%2==1&&(t="0"+t),Ir(F(t))}function Ur(t){return b(Dr(t))}function Br(t){return zr($r(t))}function Nr(t){return decodeURIComponent(Yr(t))}function Or(t){for(var e="",r=0;r<t.length-1;r+=2)e+=String.fromCharCode(parseInt(t.substr(r,2),16));return e}function jr(t){for(var e="",r=0;r<t.length;r++)e+=("0"+t.charCodeAt(r).toString(16)).slice(-2);return e}function Hr(t){return F(t)}function Mr(t){var e=Hr(t).replace(/(.{64})/g,"$1\r\n");return e=e.replace(/\r\n$/,"")}function Kr(t){return b(t.replace(/[^0-9A-Za-z\/+=]*/g,""))}function Vr(t,e){return "-----BEGIN "+e+"-----\r\n"+Mr(t)+"\r\n-----END "+e+"-----\r\n"}function qr(t,e){if(-1==t.indexOf("-----BEGIN "))throw "can't find PEM header: "+e;return Kr(t=void 0!==e?(t=t.replace("-----BEGIN "+e+"-----","")).replace("-----END "+e+"-----",""):(t=t.replace(/-----BEGIN [^-]+-----/,"")).replace(/-----END [^-]+-----/,""))}function Jr(t){var e,r,n,i,o,s,a,u,c,h,l;if(l=t.match(/^(\d{2}|\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(|\.\d+)Z$/))return u=l[1],e=parseInt(u),2===u.length&&(50<=e&&e<100?e=1900+e:0<=e&&e<50&&(e=2e3+e)),r=parseInt(l[2])-1,n=parseInt(l[3]),i=parseInt(l[4]),o=parseInt(l[5]),s=parseInt(l[6]),a=0,""!==(c=l[7])&&(h=(c.substr(1)+"00").substr(0,3),a=parseInt(h)),Date.UTC(e,r,n,i,o,s,a);throw "unsupported zulu format: "+t}function Wr(t){return ~~(Jr(t)/1e3)}function zr(t){return t.replace(/%/g,"")}function Yr(t){return t.replace(/(..)/g,"%$1")}function Gr(t){var e="malformed IPv6 address";if(!t.match(/^[0-9A-Fa-f:]+$/))throw e;var r=(t=t.toLowerCase()).split(":").length-1;if(r<2)throw e;var n=":".repeat(7-r+2),i=(t=t.replace("::",n)).split(":");if(8!=i.length)throw e;for(var o=0;o<8;o++)i[o]=("0000"+i[o]).slice(-4);return i.join("")}function Xr(t){if(!t.match(/^[0-9A-Fa-f]{32}$/))throw "malformed IPv6 address octet";for(var e=(t=t.toLowerCase()).match(/.{1,4}/g),r=0;r<8;r++)e[r]=e[r].replace(/^0+/,""),""==e[r]&&(e[r]="0");var n=(t=":"+e.join(":")+":").match(/:(0:){2,}/g);if(null===n)return t.slice(1,-1);var i="";for(r=0;r<n.length;r++)n[r].length>i.length&&(i=n[r]);return (t=t.replace(i,"::")).slice(1,-1)}function Qr(t){var e="malformed hex value";if(!t.match(/^([0-9A-Fa-f][0-9A-Fa-f]){1,}$/))throw e;if(8!=t.length)return 32==t.length?Xr(t):t;try{return parseInt(t.substr(0,2),16)+"."+parseInt(t.substr(2,2),16)+"."+parseInt(t.substr(4,2),16)+"."+parseInt(t.substr(6,2),16)}catch(t){throw e}}function $r(t){for(var e=encodeURIComponent(t),r="",n=0;n<e.length;n++)"%"==e[n]?(r+=e.substr(n,3),n+=2):r=r+"%"+Rr(e[n]);return r}function Zr(t){return t.length%2==1?"0"+t:t.substr(0,1)>"7"?"00"+t:t}Ar.getLblen=function(t,e){if("8"!=t.substr(e+2,1))return 1;var r=parseInt(t.substr(e+3,1));return 0==r?-1:0<r&&r<10?r+1:-2},Ar.getL=function(t,e){var r=Ar.getLblen(t,e);return r<1?"":t.substr(e+2,2*r)},Ar.getVblen=function(t,e){var r;return ""==(r=Ar.getL(t,e))?-1:("8"===r.substr(0,1)?new E(r.substr(2),16):new E(r,16)).intValue()},Ar.getVidx=function(t,e){var r=Ar.getLblen(t,e);return r<0?r:e+2*(r+1)},Ar.getV=function(t,e){var r=Ar.getVidx(t,e),n=Ar.getVblen(t,e);return t.substr(r,2*n)},Ar.getTLV=function(t,e){return t.substr(e,2)+Ar.getL(t,e)+Ar.getV(t,e)},Ar.getNextSiblingIdx=function(t,e){return Ar.getVidx(t,e)+2*Ar.getVblen(t,e)},Ar.getChildIdx=function(t,e){var r=Ar,n=new Array,i=r.getVidx(t,e);"03"==t.substr(e,2)?n.push(i+2):n.push(i);for(var o=r.getVblen(t,e),s=i,a=0;;){var u=r.getNextSiblingIdx(t,s);if(null==u||u-i>=2*o)break;if(a>=200)break;n.push(u),s=u,a++;}return n},Ar.getNthChildIdx=function(t,e,r){return Ar.getChildIdx(t,e)[r]},Ar.getIdxbyList=function(t,e,r,n){var i,o,s=Ar;if(0==r.length){if(void 0!==n&&t.substr(e,2)!==n)throw "checking tag doesn't match: "+t.substr(e,2)+"!="+n;return e}return i=r.shift(),o=s.getChildIdx(t,e),s.getIdxbyList(t,o[i],r,n)},Ar.getTLVbyList=function(t,e,r,n){var i=Ar,o=i.getIdxbyList(t,e,r);if(void 0===o)throw "can't find nthList object";if(void 0!==n&&t.substr(o,2)!=n)throw "checking tag doesn't match: "+t.substr(o,2)+"!="+n;return i.getTLV(t,o)},Ar.getVbyList=function(t,e,r,n,i){var o,s,a=Ar;if(void 0===(o=a.getIdxbyList(t,e,r,n)))throw "can't find nthList object";return s=a.getV(t,o),!0===i&&(s=s.substr(2)),s},Ar.hextooidstr=function(t){var e=function t(e,r){return e.length>=r?e:new Array(r-e.length+1).join("0")+e},r=[],n=t.substr(0,2),i=parseInt(n,16);r[0]=new String(Math.floor(i/40)),r[1]=new String(i%40);for(var o=t.substr(2),s=[],a=0;a<o.length/2;a++)s.push(parseInt(o.substr(2*a,2),16));var u=[],c="";for(a=0;a<s.length;a++)128&s[a]?c+=e((127&s[a]).toString(2),7):(c+=e((127&s[a]).toString(2),7),u.push(new String(parseInt(c,2))),c="");var h=r.join(".");return u.length>0&&(h=h+"."+u.join(".")),h},Ar.dump=function(t,e,r,n){var i=Ar,o=i.getV,s=i.dump,a=i.getChildIdx,u=t;t instanceof Er.asn1.ASN1Object&&(u=t.getEncodedHex());var c=function t(e,r){return e.length<=2*r?e:e.substr(0,r)+"..(total "+e.length/2+"bytes).."+e.substr(e.length-r,r)};void 0===e&&(e={ommit_long_octet:32}),void 0===r&&(r=0),void 0===n&&(n="");var h=e.ommit_long_octet;if("01"==u.substr(r,2))return "00"==(l=o(u,r))?n+"BOOLEAN FALSE\n":n+"BOOLEAN TRUE\n";if("02"==u.substr(r,2))return n+"INTEGER "+c(l=o(u,r),h)+"\n";if("03"==u.substr(r,2))return n+"BITSTRING "+c(l=o(u,r),h)+"\n";if("04"==u.substr(r,2)){var l=o(u,r);if(i.isASN1HEX(l)){var f=n+"OCTETSTRING, encapsulates\n";return f+=s(l,e,0,n+"  ")}return n+"OCTETSTRING "+c(l,h)+"\n"}if("05"==u.substr(r,2))return n+"NULL\n";if("06"==u.substr(r,2)){var d=o(u,r),p=Er.asn1.ASN1Util.oidHexToInt(d),g=Er.asn1.x509.OID.oid2name(p),v=p.replace(/\./g," ");return ""!=g?n+"ObjectIdentifier "+g+" ("+v+")\n":n+"ObjectIdentifier ("+v+")\n"}if("0c"==u.substr(r,2))return n+"UTF8String '"+Nr(o(u,r))+"'\n";if("13"==u.substr(r,2))return n+"PrintableString '"+Nr(o(u,r))+"'\n";if("14"==u.substr(r,2))return n+"TeletexString '"+Nr(o(u,r))+"'\n";if("16"==u.substr(r,2))return n+"IA5String '"+Nr(o(u,r))+"'\n";if("17"==u.substr(r,2))return n+"UTCTime "+Nr(o(u,r))+"\n";if("18"==u.substr(r,2))return n+"GeneralizedTime "+Nr(o(u,r))+"\n";if("30"==u.substr(r,2)){if("3000"==u.substr(r,4))return n+"SEQUENCE {}\n";f=n+"SEQUENCE\n";var y=e;if((2==(S=a(u,r)).length||3==S.length)&&"06"==u.substr(S[0],2)&&"04"==u.substr(S[S.length-1],2)){g=i.oidname(o(u,S[0]));var m=JSON.parse(JSON.stringify(e));m.x509ExtName=g,y=m;}for(var _=0;_<S.length;_++)f+=s(u,y,S[_],n+"  ");return f}if("31"==u.substr(r,2)){f=n+"SET\n";var S=a(u,r);for(_=0;_<S.length;_++)f+=s(u,e,S[_],n+"  ");return f}var F=parseInt(u.substr(r,2),16);if(0!=(128&F)){var b=31&F;if(0!=(32&F)){var f=n+"["+b+"]\n";for(S=a(u,r),_=0;_<S.length;_++)f+=s(u,e,S[_],n+"  ");return f}return "68747470"==(l=o(u,r)).substr(0,8)&&(l=Nr(l)),"subjectAltName"===e.x509ExtName&&2==b&&(l=Nr(l)),f=n+"["+b+"] "+l+"\n"}return n+"UNKNOWN("+u.substr(r,2)+") "+o(u,r)+"\n"},Ar.isASN1HEX=function(t){var e=Ar;if(t.length%2==1)return !1;var r=e.getVblen(t,0),n=t.substr(0,2),i=e.getL(t,0);return t.length-n.length-i.length==2*r},Ar.oidname=function(t){var e=Er.asn1;Er.lang.String.isHex(t)&&(t=e.ASN1Util.oidHexToInt(t));var r=e.x509.OID.oid2name(t);return ""===r&&(r=t),r},void 0!==Er&&Er||(e.KJUR=Er={}),void 0!==Er.lang&&Er.lang||(Er.lang={}),Er.lang.String=function(){},"function"==typeof t?(e.utf8tob64u=xr=function e(r){return Ir(new t(r,"utf8").toString("base64"))},e.b64utoutf8=kr=function e(r){return new t(Dr(r),"base64").toString("utf8")}):(e.utf8tob64u=xr=function t(e){return Lr(zr($r(e)))},e.b64utoutf8=kr=function t(e){return decodeURIComponent(Yr(Ur(e)))}),Er.lang.String.isInteger=function(t){return !!t.match(/^[0-9]+$/)||!!t.match(/^-[0-9]+$/)},Er.lang.String.isHex=function(t){return !(t.length%2!=0||!t.match(/^[0-9a-f]+$/)&&!t.match(/^[0-9A-F]+$/))},Er.lang.String.isBase64=function(t){return !(!(t=t.replace(/\s+/g,"")).match(/^[0-9A-Za-z+\/]+={0,3}$/)||t.length%4!=0)},Er.lang.String.isBase64URL=function(t){return !t.match(/[+/=]/)&&(t=Dr(t),Er.lang.String.isBase64(t))},Er.lang.String.isIntegerArray=function(t){return !!(t=t.replace(/\s+/g,"")).match(/^\[[0-9,]+\]$/)};void 0!==Er&&Er||(e.KJUR=Er={}),void 0!==Er.crypto&&Er.crypto||(Er.crypto={}),Er.crypto.Util=new function(){this.DIGESTINFOHEAD={sha1:"3021300906052b0e03021a05000414",sha224:"302d300d06096086480165030402040500041c",sha256:"3031300d060960864801650304020105000420",sha384:"3041300d060960864801650304020205000430",sha512:"3051300d060960864801650304020305000440",md2:"3020300c06082a864886f70d020205000410",md5:"3020300c06082a864886f70d020505000410",ripemd160:"3021300906052b2403020105000414"},this.DEFAULTPROVIDER={md5:"cryptojs",sha1:"cryptojs",sha224:"cryptojs",sha256:"cryptojs",sha384:"cryptojs",sha512:"cryptojs",ripemd160:"cryptojs",hmacmd5:"cryptojs",hmacsha1:"cryptojs",hmacsha224:"cryptojs",hmacsha256:"cryptojs",hmacsha384:"cryptojs",hmacsha512:"cryptojs",hmacripemd160:"cryptojs",MD5withRSA:"cryptojs/jsrsa",SHA1withRSA:"cryptojs/jsrsa",SHA224withRSA:"cryptojs/jsrsa",SHA256withRSA:"cryptojs/jsrsa",SHA384withRSA:"cryptojs/jsrsa",SHA512withRSA:"cryptojs/jsrsa",RIPEMD160withRSA:"cryptojs/jsrsa",MD5withECDSA:"cryptojs/jsrsa",SHA1withECDSA:"cryptojs/jsrsa",SHA224withECDSA:"cryptojs/jsrsa",SHA256withECDSA:"cryptojs/jsrsa",SHA384withECDSA:"cryptojs/jsrsa",SHA512withECDSA:"cryptojs/jsrsa",RIPEMD160withECDSA:"cryptojs/jsrsa",SHA1withDSA:"cryptojs/jsrsa",SHA224withDSA:"cryptojs/jsrsa",SHA256withDSA:"cryptojs/jsrsa",MD5withRSAandMGF1:"cryptojs/jsrsa",SHA1withRSAandMGF1:"cryptojs/jsrsa",SHA224withRSAandMGF1:"cryptojs/jsrsa",SHA256withRSAandMGF1:"cryptojs/jsrsa",SHA384withRSAandMGF1:"cryptojs/jsrsa",SHA512withRSAandMGF1:"cryptojs/jsrsa",RIPEMD160withRSAandMGF1:"cryptojs/jsrsa"},this.CRYPTOJSMESSAGEDIGESTNAME={md5:y.algo.MD5,sha1:y.algo.SHA1,sha224:y.algo.SHA224,sha256:y.algo.SHA256,sha384:y.algo.SHA384,sha512:y.algo.SHA512,ripemd160:y.algo.RIPEMD160},this.getDigestInfoHex=function(t,e){if(void 0===this.DIGESTINFOHEAD[e])throw "alg not supported in Util.DIGESTINFOHEAD: "+e;return this.DIGESTINFOHEAD[e]+t},this.getPaddedDigestInfoHex=function(t,e,r){var n=this.getDigestInfoHex(t,e),i=r/4;if(n.length+22>i)throw "key is too short for SigAlg: keylen="+r+","+e;for(var o="0001",s="00"+n,a="",u=i-o.length-s.length,c=0;c<u;c+=2)a+="ff";return o+a+s},this.hashString=function(t,e){return new Er.crypto.MessageDigest({alg:e}).digestString(t)},this.hashHex=function(t,e){return new Er.crypto.MessageDigest({alg:e}).digestHex(t)},this.sha1=function(t){return new Er.crypto.MessageDigest({alg:"sha1",prov:"cryptojs"}).digestString(t)},this.sha256=function(t){return new Er.crypto.MessageDigest({alg:"sha256",prov:"cryptojs"}).digestString(t)},this.sha256Hex=function(t){return new Er.crypto.MessageDigest({alg:"sha256",prov:"cryptojs"}).digestHex(t)},this.sha512=function(t){return new Er.crypto.MessageDigest({alg:"sha512",prov:"cryptojs"}).digestString(t)},this.sha512Hex=function(t){return new Er.crypto.MessageDigest({alg:"sha512",prov:"cryptojs"}).digestHex(t)};},Er.crypto.Util.md5=function(t){return new Er.crypto.MessageDigest({alg:"md5",prov:"cryptojs"}).digestString(t)},Er.crypto.Util.ripemd160=function(t){return new Er.crypto.MessageDigest({alg:"ripemd160",prov:"cryptojs"}).digestString(t)},Er.crypto.Util.SECURERANDOMGEN=new Me,Er.crypto.Util.getRandomHexOfNbytes=function(t){var e=new Array(t);return Er.crypto.Util.SECURERANDOMGEN.nextBytes(e),Tr(e)},Er.crypto.Util.getRandomBigIntegerOfNbytes=function(t){return new E(Er.crypto.Util.getRandomHexOfNbytes(t),16)},Er.crypto.Util.getRandomHexOfNbits=function(t){var e=t%8,r=new Array((t-e)/8+1);return Er.crypto.Util.SECURERANDOMGEN.nextBytes(r),r[0]=(255<<e&255^255)&r[0],Tr(r)},Er.crypto.Util.getRandomBigIntegerOfNbits=function(t){return new E(Er.crypto.Util.getRandomHexOfNbits(t),16)},Er.crypto.Util.getRandomBigIntegerZeroToMax=function(t){for(var e=t.bitLength();;){var r=Er.crypto.Util.getRandomBigIntegerOfNbits(e);if(-1!=t.compareTo(r))return r}},Er.crypto.Util.getRandomBigIntegerMinToMax=function(t,e){var r=t.compareTo(e);if(1==r)throw "biMin is greater than biMax";if(0==r)return t;var n=e.subtract(t);return Er.crypto.Util.getRandomBigIntegerZeroToMax(n).add(t)},Er.crypto.MessageDigest=function(t){this.setAlgAndProvider=function(t,e){if(null!==(t=Er.crypto.MessageDigest.getCanonicalAlgName(t))&&void 0===e&&(e=Er.crypto.Util.DEFAULTPROVIDER[t]),-1!=":md5:sha1:sha224:sha256:sha384:sha512:ripemd160:".indexOf(t)&&"cryptojs"==e){try{this.md=Er.crypto.Util.CRYPTOJSMESSAGEDIGESTNAME[t].create();}catch(e){throw "setAlgAndProvider hash alg set fail alg="+t+"/"+e}this.updateString=function(t){this.md.update(t);},this.updateHex=function(t){var e=y.enc.Hex.parse(t);this.md.update(e);},this.digest=function(){return this.md.finalize().toString(y.enc.Hex)},this.digestString=function(t){return this.updateString(t),this.digest()},this.digestHex=function(t){return this.updateHex(t),this.digest()};}if(-1!=":sha256:".indexOf(t)&&"sjcl"==e){try{this.md=new sjcl.hash.sha256;}catch(e){throw "setAlgAndProvider hash alg set fail alg="+t+"/"+e}this.updateString=function(t){this.md.update(t);},this.updateHex=function(t){var e=sjcl.codec.hex.toBits(t);this.md.update(e);},this.digest=function(){var t=this.md.finalize();return sjcl.codec.hex.fromBits(t)},this.digestString=function(t){return this.updateString(t),this.digest()},this.digestHex=function(t){return this.updateHex(t),this.digest()};}},this.updateString=function(t){throw "updateString(str) not supported for this alg/prov: "+this.algName+"/"+this.provName},this.updateHex=function(t){throw "updateHex(hex) not supported for this alg/prov: "+this.algName+"/"+this.provName},this.digest=function(){throw "digest() not supported for this alg/prov: "+this.algName+"/"+this.provName},this.digestString=function(t){throw "digestString(str) not supported for this alg/prov: "+this.algName+"/"+this.provName},this.digestHex=function(t){throw "digestHex(hex) not supported for this alg/prov: "+this.algName+"/"+this.provName},void 0!==t&&void 0!==t.alg&&(this.algName=t.alg,void 0===t.prov&&(this.provName=Er.crypto.Util.DEFAULTPROVIDER[this.algName]),this.setAlgAndProvider(this.algName,this.provName));},Er.crypto.MessageDigest.getCanonicalAlgName=function(t){return "string"==typeof t&&(t=(t=t.toLowerCase()).replace(/-/,"")),t},Er.crypto.MessageDigest.getHashLength=function(t){var e=Er.crypto.MessageDigest,r=e.getCanonicalAlgName(t);if(void 0===e.HASHLENGTH[r])throw "not supported algorithm: "+t;return e.HASHLENGTH[r]},Er.crypto.MessageDigest.HASHLENGTH={md5:16,sha1:20,sha224:28,sha256:32,sha384:48,sha512:64,ripemd160:20},Er.crypto.Mac=function(t){this.setAlgAndProvider=function(t,e){if(null==(t=t.toLowerCase())&&(t="hmacsha1"),"hmac"!=(t=t.toLowerCase()).substr(0,4))throw "setAlgAndProvider unsupported HMAC alg: "+t;void 0===e&&(e=Er.crypto.Util.DEFAULTPROVIDER[t]),this.algProv=t+"/"+e;var r=t.substr(4);if(-1!=":md5:sha1:sha224:sha256:sha384:sha512:ripemd160:".indexOf(r)&&"cryptojs"==e){try{var n=Er.crypto.Util.CRYPTOJSMESSAGEDIGESTNAME[r];this.mac=y.algo.HMAC.create(n,this.pass);}catch(t){throw "setAlgAndProvider hash alg set fail hashAlg="+r+"/"+t}this.updateString=function(t){this.mac.update(t);},this.updateHex=function(t){var e=y.enc.Hex.parse(t);this.mac.update(e);},this.doFinal=function(){return this.mac.finalize().toString(y.enc.Hex)},this.doFinalString=function(t){return this.updateString(t),this.doFinal()},this.doFinalHex=function(t){return this.updateHex(t),this.doFinal()};}},this.updateString=function(t){throw "updateString(str) not supported for this alg/prov: "+this.algProv},this.updateHex=function(t){throw "updateHex(hex) not supported for this alg/prov: "+this.algProv},this.doFinal=function(){throw "digest() not supported for this alg/prov: "+this.algProv},this.doFinalString=function(t){throw "digestString(str) not supported for this alg/prov: "+this.algProv},this.doFinalHex=function(t){throw "digestHex(hex) not supported for this alg/prov: "+this.algProv},this.setPassword=function(t){if("string"==typeof t){var e=t;return t.length%2!=1&&t.match(/^[0-9A-Fa-f]+$/)||(e=jr(t)),void(this.pass=y.enc.Hex.parse(e))}if("object"!=(void 0===t?"undefined":r(t)))throw "KJUR.crypto.Mac unsupported password type: "+t;e=null;if(void 0!==t.hex){if(t.hex.length%2!=0||!t.hex.match(/^[0-9A-Fa-f]+$/))throw "Mac: wrong hex password: "+t.hex;e=t.hex;}if(void 0!==t.utf8&&(e=Br(t.utf8)),void 0!==t.rstr&&(e=jr(t.rstr)),void 0!==t.b64&&(e=b(t.b64)),void 0!==t.b64u&&(e=Ur(t.b64u)),null==e)throw "KJUR.crypto.Mac unsupported password type: "+t;this.pass=y.enc.Hex.parse(e);},void 0!==t&&(void 0!==t.pass&&this.setPassword(t.pass),void 0!==t.alg&&(this.algName=t.alg,void 0===t.prov&&(this.provName=Er.crypto.Util.DEFAULTPROVIDER[this.algName]),this.setAlgAndProvider(this.algName,this.provName)));},Er.crypto.Signature=function(t){var e=null;if(this._setAlgNames=function(){var t=this.algName.match(/^(.+)with(.+)$/);t&&(this.mdAlgName=t[1].toLowerCase(),this.pubkeyAlgName=t[2].toLowerCase());},this._zeroPaddingOfSignature=function(t,e){for(var r="",n=e/4-t.length,i=0;i<n;i++)r+="0";return r+t},this.setAlgAndProvider=function(t,e){if(this._setAlgNames(),"cryptojs/jsrsa"!=e)throw "provider not supported: "+e;if(-1!=":md5:sha1:sha224:sha256:sha384:sha512:ripemd160:".indexOf(this.mdAlgName)){try{this.md=new Er.crypto.MessageDigest({alg:this.mdAlgName});}catch(t){throw "setAlgAndProvider hash alg set fail alg="+this.mdAlgName+"/"+t}this.init=function(t,e){var r=null;try{r=void 0===e?tn.getKey(t):tn.getKey(t,e);}catch(t){throw "init failed:"+t}if(!0===r.isPrivate)this.prvKey=r,this.state="SIGN";else{if(!0!==r.isPublic)throw "init failed.:"+r;this.pubKey=r,this.state="VERIFY";}},this.updateString=function(t){this.md.updateString(t);},this.updateHex=function(t){this.md.updateHex(t);},this.sign=function(){if(this.sHashHex=this.md.digest(),void 0!==this.ecprvhex&&void 0!==this.eccurvename){var t=new Er.crypto.ECDSA({curve:this.eccurvename});this.hSign=t.signHex(this.sHashHex,this.ecprvhex);}else if(this.prvKey instanceof qe&&"rsaandmgf1"===this.pubkeyAlgName)this.hSign=this.prvKey.signWithMessageHashPSS(this.sHashHex,this.mdAlgName,this.pssSaltLen);else if(this.prvKey instanceof qe&&"rsa"===this.pubkeyAlgName)this.hSign=this.prvKey.signWithMessageHash(this.sHashHex,this.mdAlgName);else if(this.prvKey instanceof Er.crypto.ECDSA)this.hSign=this.prvKey.signWithMessageHash(this.sHashHex);else{if(!(this.prvKey instanceof Er.crypto.DSA))throw "Signature: unsupported private key alg: "+this.pubkeyAlgName;this.hSign=this.prvKey.signWithMessageHash(this.sHashHex);}return this.hSign},this.signString=function(t){return this.updateString(t),this.sign()},this.signHex=function(t){return this.updateHex(t),this.sign()},this.verify=function(t){if(this.sHashHex=this.md.digest(),void 0!==this.ecpubhex&&void 0!==this.eccurvename)return new Er.crypto.ECDSA({curve:this.eccurvename}).verifyHex(this.sHashHex,t,this.ecpubhex);if(this.pubKey instanceof qe&&"rsaandmgf1"===this.pubkeyAlgName)return this.pubKey.verifyWithMessageHashPSS(this.sHashHex,t,this.mdAlgName,this.pssSaltLen);if(this.pubKey instanceof qe&&"rsa"===this.pubkeyAlgName)return this.pubKey.verifyWithMessageHash(this.sHashHex,t);if(void 0!==Er.crypto.ECDSA&&this.pubKey instanceof Er.crypto.ECDSA)return this.pubKey.verifyWithMessageHash(this.sHashHex,t);if(void 0!==Er.crypto.DSA&&this.pubKey instanceof Er.crypto.DSA)return this.pubKey.verifyWithMessageHash(this.sHashHex,t);throw "Signature: unsupported public key alg: "+this.pubkeyAlgName};}},this.init=function(t,e){throw "init(key, pass) not supported for this alg:prov="+this.algProvName},this.updateString=function(t){throw "updateString(str) not supported for this alg:prov="+this.algProvName},this.updateHex=function(t){throw "updateHex(hex) not supported for this alg:prov="+this.algProvName},this.sign=function(){throw "sign() not supported for this alg:prov="+this.algProvName},this.signString=function(t){throw "digestString(str) not supported for this alg:prov="+this.algProvName},this.signHex=function(t){throw "digestHex(hex) not supported for this alg:prov="+this.algProvName},this.verify=function(t){throw "verify(hSigVal) not supported for this alg:prov="+this.algProvName},this.initParams=t,void 0!==t&&(void 0!==t.alg&&(this.algName=t.alg,void 0===t.prov?this.provName=Er.crypto.Util.DEFAULTPROVIDER[this.algName]:this.provName=t.prov,this.algProvName=this.algName+":"+this.provName,this.setAlgAndProvider(this.algName,this.provName),this._setAlgNames()),void 0!==t.psssaltlen&&(this.pssSaltLen=t.psssaltlen),void 0!==t.prvkeypem)){if(void 0!==t.prvkeypas)throw "both prvkeypem and prvkeypas parameters not supported";try{e=tn.getKey(t.prvkeypem);this.init(e);}catch(t){throw "fatal error to load pem private key: "+t}}},Er.crypto.Cipher=function(t){},Er.crypto.Cipher.encrypt=function(t,e,r){if(e instanceof qe&&e.isPublic){var n=Er.crypto.Cipher.getAlgByKeyAndName(e,r);if("RSA"===n)return e.encrypt(t);if("RSAOAEP"===n)return e.encryptOAEP(t,"sha1");var i=n.match(/^RSAOAEP(\d+)$/);if(null!==i)return e.encryptOAEP(t,"sha"+i[1]);throw "Cipher.encrypt: unsupported algorithm for RSAKey: "+r}throw "Cipher.encrypt: unsupported key or algorithm"},Er.crypto.Cipher.decrypt=function(t,e,r){if(e instanceof qe&&e.isPrivate){var n=Er.crypto.Cipher.getAlgByKeyAndName(e,r);if("RSA"===n)return e.decrypt(t);if("RSAOAEP"===n)return e.decryptOAEP(t,"sha1");var i=n.match(/^RSAOAEP(\d+)$/);if(null!==i)return e.decryptOAEP(t,"sha"+i[1]);throw "Cipher.decrypt: unsupported algorithm for RSAKey: "+r}throw "Cipher.decrypt: unsupported key or algorithm"},Er.crypto.Cipher.getAlgByKeyAndName=function(t,e){if(t instanceof qe){if(-1!=":RSA:RSAOAEP:RSAOAEP224:RSAOAEP256:RSAOAEP384:RSAOAEP512:".indexOf(e))return e;if(null===e||void 0===e)return "RSA";throw "getAlgByKeyAndName: not supported algorithm name for RSAKey: "+e}throw "getAlgByKeyAndName: not supported algorithm name: "+e},Er.crypto.OID=new function(){this.oidhex2name={"2a864886f70d010101":"rsaEncryption","2a8648ce3d0201":"ecPublicKey","2a8648ce380401":"dsa","2a8648ce3d030107":"secp256r1","2b8104001f":"secp192k1","2b81040021":"secp224r1","2b8104000a":"secp256k1","2b81040023":"secp521r1","2b81040022":"secp384r1","2a8648ce380403":"SHA1withDSA","608648016503040301":"SHA224withDSA","608648016503040302":"SHA256withDSA"};},void 0!==Er&&Er||(e.KJUR=Er={}),void 0!==Er.crypto&&Er.crypto||(Er.crypto={}),Er.crypto.ECDSA=function(t){var e=new Me;this.type="EC",this.isPrivate=!1,this.isPublic=!1,this.getBigRandom=function(t){return new E(t.bitLength(),e).mod(t.subtract(E.ONE)).add(E.ONE)},this.setNamedCurve=function(t){this.ecparams=Er.crypto.ECParameterDB.getByName(t),this.prvKeyHex=null,this.pubKeyHex=null,this.curveName=t;},this.setPrivateKeyHex=function(t){this.isPrivate=!0,this.prvKeyHex=t;},this.setPublicKeyHex=function(t){this.isPublic=!0,this.pubKeyHex=t;},this.getPublicKeyXYHex=function(){var t=this.pubKeyHex;if("04"!==t.substr(0,2))throw "this method supports uncompressed format(04) only";var e=this.ecparams.keylen/4;if(t.length!==2+2*e)throw "malformed public key hex length";var r={};return r.x=t.substr(2,e),r.y=t.substr(2+e),r},this.getShortNISTPCurveName=function(){var t=this.curveName;return "secp256r1"===t||"NIST P-256"===t||"P-256"===t||"prime256v1"===t?"P-256":"secp384r1"===t||"NIST P-384"===t||"P-384"===t?"P-384":null},this.generateKeyPairHex=function(){var t=this.ecparams.n,e=this.getBigRandom(t),r=this.ecparams.G.multiply(e),n=r.getX().toBigInteger(),i=r.getY().toBigInteger(),o=this.ecparams.keylen/4,s=("0000000000"+e.toString(16)).slice(-o),a="04"+("0000000000"+n.toString(16)).slice(-o)+("0000000000"+i.toString(16)).slice(-o);return this.setPrivateKeyHex(s),this.setPublicKeyHex(a),{ecprvhex:s,ecpubhex:a}},this.signWithMessageHash=function(t){return this.signHex(t,this.prvKeyHex)},this.signHex=function(t,e){var r=new E(e,16),n=this.ecparams.n,i=new E(t,16);do{var o=this.getBigRandom(n),s=this.ecparams.G.multiply(o).getX().toBigInteger().mod(n);}while(s.compareTo(E.ZERO)<=0);var a=o.modInverse(n).multiply(i.add(r.multiply(s))).mod(n);return Er.crypto.ECDSA.biRSSigToASN1Sig(s,a)},this.sign=function(t,e){var r=e,n=this.ecparams.n,i=E.fromByteArrayUnsigned(t);do{var o=this.getBigRandom(n),s=this.ecparams.G.multiply(o).getX().toBigInteger().mod(n);}while(s.compareTo(E.ZERO)<=0);var a=o.modInverse(n).multiply(i.add(r.multiply(s))).mod(n);return this.serializeSig(s,a)},this.verifyWithMessageHash=function(t,e){return this.verifyHex(t,e,this.pubKeyHex)},this.verifyHex=function(t,e,r){var n,i,o,s=Er.crypto.ECDSA.parseSigHex(e);n=s.r,i=s.s,o=We.decodeFromHex(this.ecparams.curve,r);var a=new E(t,16);return this.verifyRaw(a,n,i,o)},this.verify=function(t,e,n){var i,o,s;if(Bitcoin.Util.isArray(e)){var a=this.parseSig(e);i=a.r,o=a.s;}else{if("object"!==(void 0===e?"undefined":r(e))||!e.r||!e.s)throw "Invalid value for signature";i=e.r,o=e.s;}if(n instanceof We)s=n;else{if(!Bitcoin.Util.isArray(n))throw "Invalid format for pubkey value, must be byte array or ECPointFp";s=We.decodeFrom(this.ecparams.curve,n);}var u=E.fromByteArrayUnsigned(t);return this.verifyRaw(u,i,o,s)},this.verifyRaw=function(t,e,r,n){var i=this.ecparams.n,o=this.ecparams.G;if(e.compareTo(E.ONE)<0||e.compareTo(i)>=0)return !1;if(r.compareTo(E.ONE)<0||r.compareTo(i)>=0)return !1;var s=r.modInverse(i),a=t.multiply(s).mod(i),u=e.multiply(s).mod(i);return o.multiply(a).add(n.multiply(u)).getX().toBigInteger().mod(i).equals(e)},this.serializeSig=function(t,e){var r=t.toByteArraySigned(),n=e.toByteArraySigned(),i=[];return i.push(2),i.push(r.length),(i=i.concat(r)).push(2),i.push(n.length),(i=i.concat(n)).unshift(i.length),i.unshift(48),i},this.parseSig=function(t){var e;if(48!=t[0])throw new Error("Signature not a valid DERSequence");if(2!=t[e=2])throw new Error("First element in signature must be a DERInteger");var r=t.slice(e+2,e+2+t[e+1]);if(2!=t[e+=2+t[e+1]])throw new Error("Second element in signature must be a DERInteger");var n=t.slice(e+2,e+2+t[e+1]);return e+=2+t[e+1],{r:E.fromByteArrayUnsigned(r),s:E.fromByteArrayUnsigned(n)}},this.parseSigCompact=function(t){if(65!==t.length)throw "Signature has the wrong length";var e=t[0]-27;if(e<0||e>7)throw "Invalid signature type";var r=this.ecparams.n;return {r:E.fromByteArrayUnsigned(t.slice(1,33)).mod(r),s:E.fromByteArrayUnsigned(t.slice(33,65)).mod(r),i:e}},this.readPKCS5PrvKeyHex=function(t){var e,r,n,i=Ar,o=Er.crypto.ECDSA.getName,s=i.getVbyList;if(!1===i.isASN1HEX(t))throw "not ASN.1 hex string";try{e=s(t,0,[2,0],"06"),r=s(t,0,[1],"04");try{n=s(t,0,[3,0],"03").substr(2);}catch(t){}}catch(t){throw "malformed PKCS#1/5 plain ECC private key"}if(this.curveName=o(e),void 0===this.curveName)throw "unsupported curve name";this.setNamedCurve(this.curveName),this.setPublicKeyHex(n),this.setPrivateKeyHex(r),this.isPublic=!1;},this.readPKCS8PrvKeyHex=function(t){var e,r,n,i=Ar,o=Er.crypto.ECDSA.getName,s=i.getVbyList;if(!1===i.isASN1HEX(t))throw "not ASN.1 hex string";try{s(t,0,[1,0],"06"),e=s(t,0,[1,1],"06"),r=s(t,0,[2,0,1],"04");try{n=s(t,0,[2,0,2,0],"03").substr(2);}catch(t){}}catch(t){throw "malformed PKCS#8 plain ECC private key"}if(this.curveName=o(e),void 0===this.curveName)throw "unsupported curve name";this.setNamedCurve(this.curveName),this.setPublicKeyHex(n),this.setPrivateKeyHex(r),this.isPublic=!1;},this.readPKCS8PubKeyHex=function(t){var e,r,n=Ar,i=Er.crypto.ECDSA.getName,o=n.getVbyList;if(!1===n.isASN1HEX(t))throw "not ASN.1 hex string";try{o(t,0,[0,0],"06"),e=o(t,0,[0,1],"06"),r=o(t,0,[1],"03").substr(2);}catch(t){throw "malformed PKCS#8 ECC public key"}if(this.curveName=i(e),null===this.curveName)throw "unsupported curve name";this.setNamedCurve(this.curveName),this.setPublicKeyHex(r);},this.readCertPubKeyHex=function(t,e){5!==e&&(e=6);var r,n,i=Ar,o=Er.crypto.ECDSA.getName,s=i.getVbyList;if(!1===i.isASN1HEX(t))throw "not ASN.1 hex string";try{r=s(t,0,[0,e,0,1],"06"),n=s(t,0,[0,e,1],"03").substr(2);}catch(t){throw "malformed X.509 certificate ECC public key"}if(this.curveName=o(r),null===this.curveName)throw "unsupported curve name";this.setNamedCurve(this.curveName),this.setPublicKeyHex(n);},void 0!==t&&void 0!==t.curve&&(this.curveName=t.curve),void 0===this.curveName&&(this.curveName="secp256r1"),this.setNamedCurve(this.curveName),void 0!==t&&(void 0!==t.prv&&this.setPrivateKeyHex(t.prv),void 0!==t.pub&&this.setPublicKeyHex(t.pub));},Er.crypto.ECDSA.parseSigHex=function(t){var e=Er.crypto.ECDSA.parseSigHexInHexRS(t);return {r:new E(e.r,16),s:new E(e.s,16)}},Er.crypto.ECDSA.parseSigHexInHexRS=function(t){var e=Ar,r=e.getChildIdx,n=e.getV;if("30"!=t.substr(0,2))throw "signature is not a ASN.1 sequence";var i=r(t,0);if(2!=i.length)throw "number of signature ASN.1 sequence elements seem wrong";var o=i[0],s=i[1];if("02"!=t.substr(o,2))throw "1st item of sequene of signature is not ASN.1 integer";if("02"!=t.substr(s,2))throw "2nd item of sequene of signature is not ASN.1 integer";return {r:n(t,o),s:n(t,s)}},Er.crypto.ECDSA.asn1SigToConcatSig=function(t){var e=Er.crypto.ECDSA.parseSigHexInHexRS(t),r=e.r,n=e.s;if("00"==r.substr(0,2)&&r.length%32==2&&(r=r.substr(2)),"00"==n.substr(0,2)&&n.length%32==2&&(n=n.substr(2)),r.length%32==30&&(r="00"+r),n.length%32==30&&(n="00"+n),r.length%32!=0)throw "unknown ECDSA sig r length error";if(n.length%32!=0)throw "unknown ECDSA sig s length error";return r+n},Er.crypto.ECDSA.concatSigToASN1Sig=function(t){if(t.length/2*8%128!=0)throw "unknown ECDSA concatinated r-s sig  length error";var e=t.substr(0,t.length/2),r=t.substr(t.length/2);return Er.crypto.ECDSA.hexRSSigToASN1Sig(e,r)},Er.crypto.ECDSA.hexRSSigToASN1Sig=function(t,e){var r=new E(t,16),n=new E(e,16);return Er.crypto.ECDSA.biRSSigToASN1Sig(r,n)},Er.crypto.ECDSA.biRSSigToASN1Sig=function(t,e){var r=Er.asn1,n=new r.DERInteger({bigint:t}),i=new r.DERInteger({bigint:e});return new r.DERSequence({array:[n,i]}).getEncodedHex()},Er.crypto.ECDSA.getName=function(t){return "2a8648ce3d030107"===t?"secp256r1":"2b8104000a"===t?"secp256k1":"2b81040022"===t?"secp384r1":-1!=="|secp256r1|NIST P-256|P-256|prime256v1|".indexOf(t)?"secp256r1":-1!=="|secp256k1|".indexOf(t)?"secp256k1":-1!=="|secp384r1|NIST P-384|P-384|".indexOf(t)?"secp384r1":null},void 0!==Er&&Er||(e.KJUR=Er={}),void 0!==Er.crypto&&Er.crypto||(Er.crypto={}),Er.crypto.ECParameterDB=new function(){var t={},e={};function r(t){return new E(t,16)}this.getByName=function(r){var n=r;if(void 0!==e[n]&&(n=e[r]),void 0!==t[n])return t[n];throw "unregistered EC curve name: "+n},this.regist=function(n,i,o,s,a,u,c,h,l,f,d,p){t[n]={};var g=r(o),v=r(s),y=r(a),m=r(u),_=r(c),S=new ze(g,v,y),F=S.decodePointHex("04"+h+l);t[n].name=n,t[n].keylen=i,t[n].curve=S,t[n].G=F,t[n].n=m,t[n].h=_,t[n].oid=d,t[n].info=p;for(var b=0;b<f.length;b++)e[f[b]]=n;};},Er.crypto.ECParameterDB.regist("secp128r1",128,"FFFFFFFDFFFFFFFFFFFFFFFFFFFFFFFF","FFFFFFFDFFFFFFFFFFFFFFFFFFFFFFFC","E87579C11079F43DD824993C2CEE5ED3","FFFFFFFE0000000075A30D1B9038A115","1","161FF7528B899B2D0C28607CA52C5B86","CF5AC8395BAFEB13C02DA292DDED7A83",[],"","secp128r1 : SECG curve over a 128 bit prime field"),Er.crypto.ECParameterDB.regist("secp160k1",160,"FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFAC73","0","7","0100000000000000000001B8FA16DFAB9ACA16B6B3","1","3B4C382CE37AA192A4019E763036F4F5DD4D7EBB","938CF935318FDCED6BC28286531733C3F03C4FEE",[],"","secp160k1 : SECG curve over a 160 bit prime field"),Er.crypto.ECParameterDB.regist("secp160r1",160,"FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF7FFFFFFF","FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF7FFFFFFC","1C97BEFC54BD7A8B65ACF89F81D4D4ADC565FA45","0100000000000000000001F4C8F927AED3CA752257","1","4A96B5688EF573284664698968C38BB913CBFC82","23A628553168947D59DCC912042351377AC5FB32",[],"","secp160r1 : SECG curve over a 160 bit prime field"),Er.crypto.ECParameterDB.regist("secp192k1",192,"FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFEE37","0","3","FFFFFFFFFFFFFFFFFFFFFFFE26F2FC170F69466A74DEFD8D","1","DB4FF10EC057E9AE26B07D0280B7F4341DA5D1B1EAE06C7D","9B2F2F6D9C5628A7844163D015BE86344082AA88D95E2F9D",[]),Er.crypto.ECParameterDB.regist("secp192r1",192,"FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFFFFFFFFFF","FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFFFFFFFFFC","64210519E59C80E70FA7E9AB72243049FEB8DEECC146B9B1","FFFFFFFFFFFFFFFFFFFFFFFF99DEF836146BC9B1B4D22831","1","188DA80EB03090F67CBF20EB43A18800F4FF0AFD82FF1012","07192B95FFC8DA78631011ED6B24CDD573F977A11E794811",[]),Er.crypto.ECParameterDB.regist("secp224r1",224,"FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF000000000000000000000001","FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFE","B4050A850C04B3ABF54132565044B0B7D7BFD8BA270B39432355FFB4","FFFFFFFFFFFFFFFFFFFFFFFFFFFF16A2E0B8F03E13DD29455C5C2A3D","1","B70E0CBD6BB4BF7F321390B94A03C1D356C21122343280D6115C1D21","BD376388B5F723FB4C22DFE6CD4375A05A07476444D5819985007E34",[]),Er.crypto.ECParameterDB.regist("secp256k1",256,"FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F","0","7","FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141","1","79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798","483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8",[]),Er.crypto.ECParameterDB.regist("secp256r1",256,"FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF","FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC","5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B","FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551","1","6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296","4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5",["NIST P-256","P-256","prime256v1"]),Er.crypto.ECParameterDB.regist("secp384r1",384,"FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFF0000000000000000FFFFFFFF","FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFF0000000000000000FFFFFFFC","B3312FA7E23EE7E4988E056BE3F82D19181D9C6EFE8141120314088F5013875AC656398D8A2ED19D2A85C8EDD3EC2AEF","FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFC7634D81F4372DDF581A0DB248B0A77AECEC196ACCC52973","1","AA87CA22BE8B05378EB1C71EF320AD746E1D3B628BA79B9859F741E082542A385502F25DBF55296C3A545E3872760AB7","3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5f",["NIST P-384","P-384"]),Er.crypto.ECParameterDB.regist("secp521r1",521,"1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF","1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFC","051953EB9618E1C9A1F929A21A0B68540EEA2DA725B99B315F3B8B489918EF109E156193951EC7E937B1652C0BD3BB1BF073573DF883D2C34F1EF451FD46B503F00","1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFA51868783BF2F966B7FCC0148F709A5D03BB5C9B8899C47AEBB6FB71E91386409","1","C6858E06B70404E9CD9E3ECB662395B4429C648139053FB521F828AF606B4D3DBAA14B5E77EFE75928FE1DC127A2FFA8DE3348B3C1856A429BF97E7E31C2E5BD66","011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650",["NIST P-521","P-521"]);var tn=function(){var t=function t(r,n,i){return e(y.AES,r,n,i)},e=function t(e,r,n,i){var o=y.enc.Hex.parse(r),s=y.enc.Hex.parse(n),a=y.enc.Hex.parse(i),u={};u.key=s,u.iv=a,u.ciphertext=o;var c=e.decrypt(u,s,{iv:a});return y.enc.Hex.stringify(c)},r=function t(e,r,i){return n(y.AES,e,r,i)},n=function t(e,r,n,i){var o=y.enc.Hex.parse(r),s=y.enc.Hex.parse(n),a=y.enc.Hex.parse(i),u=e.encrypt(o,s,{iv:a}),c=y.enc.Hex.parse(u.toString());return y.enc.Base64.stringify(c)},i={"AES-256-CBC":{proc:t,eproc:r,keylen:32,ivlen:16},"AES-192-CBC":{proc:t,eproc:r,keylen:24,ivlen:16},"AES-128-CBC":{proc:t,eproc:r,keylen:16,ivlen:16},"DES-EDE3-CBC":{proc:function t(r,n,i){return e(y.TripleDES,r,n,i)},eproc:function t(e,r,i){return n(y.TripleDES,e,r,i)},keylen:24,ivlen:8},"DES-CBC":{proc:function t(r,n,i){return e(y.DES,r,n,i)},eproc:function t(e,r,i){return n(y.DES,e,r,i)},keylen:8,ivlen:8}},o=function t(e){var r={},n=e.match(new RegExp("DEK-Info: ([^,]+),([0-9A-Fa-f]+)","m"));n&&(r.cipher=n[1],r.ivsalt=n[2]);var i=e.match(new RegExp("-----BEGIN ([A-Z]+) PRIVATE KEY-----"));i&&(r.type=i[1]);var o=-1,s=0;-1!=e.indexOf("\r\n\r\n")&&(o=e.indexOf("\r\n\r\n"),s=2),-1!=e.indexOf("\n\n")&&(o=e.indexOf("\n\n"),s=1);var a=e.indexOf("-----END");if(-1!=o&&-1!=a){var u=e.substring(o+2*s,a-s);u=u.replace(/\s+/g,""),r.data=u;}return r},s=function t(e,r,n){for(var o=n.substring(0,16),s=y.enc.Hex.parse(o),a=y.enc.Utf8.parse(r),u=i[e].keylen+i[e].ivlen,c="",h=null;;){var l=y.algo.MD5.create();if(null!=h&&l.update(h),l.update(a),l.update(s),h=l.finalize(),(c+=y.enc.Hex.stringify(h)).length>=2*u)break}var f={};return f.keyhex=c.substr(0,2*i[e].keylen),f.ivhex=c.substr(2*i[e].keylen,2*i[e].ivlen),f},a=function t(e,r,n,o){var s=y.enc.Base64.parse(e),a=y.enc.Hex.stringify(s);return (0, i[r].proc)(a,n,o)};return {version:"1.0.0",parsePKCS5PEM:function t(e){return o(e)},getKeyAndUnusedIvByPasscodeAndIvsalt:function t(e,r,n){return s(e,r,n)},decryptKeyB64:function t(e,r,n,i){return a(e,r,n,i)},getDecryptedKeyHex:function t(e,r){var n=o(e),i=(n.cipher),u=n.ivsalt,c=n.data,h=s(i,r,u).keyhex;return a(c,i,h,u)},getEncryptedPKCS5PEMFromPrvKeyHex:function t(e,r,n,o,a){var u="";if(void 0!==o&&null!=o||(o="AES-256-CBC"),void 0===i[o])throw "KEYUTIL unsupported algorithm: "+o;void 0!==a&&null!=a||(a=function t(e){var r=y.lib.WordArray.random(e);return y.enc.Hex.stringify(r)}(i[o].ivlen).toUpperCase());var c=function t(e,r,n,o){return (0, i[r].eproc)(e,n,o)}(r,o,s(o,n,a).keyhex,a);u="-----BEGIN "+e+" PRIVATE KEY-----\r\n";return u+="Proc-Type: 4,ENCRYPTED\r\n",u+="DEK-Info: "+o+","+a+"\r\n",u+="\r\n",u+=c.replace(/(.{64})/g,"$1\r\n"),u+="\r\n-----END "+e+" PRIVATE KEY-----\r\n"},parseHexOfEncryptedPKCS8:function t(e){var r=Ar,n=r.getChildIdx,i=r.getV,o={},s=n(e,0);if(2!=s.length)throw "malformed format: SEQUENCE(0).items != 2: "+s.length;o.ciphertext=i(e,s[1]);var a=n(e,s[0]);if(2!=a.length)throw "malformed format: SEQUENCE(0.0).items != 2: "+a.length;if("2a864886f70d01050d"!=i(e,a[0]))throw "this only supports pkcs5PBES2";var u=n(e,a[1]);if(2!=a.length)throw "malformed format: SEQUENCE(0.0.1).items != 2: "+u.length;var c=n(e,u[1]);if(2!=c.length)throw "malformed format: SEQUENCE(0.0.1.1).items != 2: "+c.length;if("2a864886f70d0307"!=i(e,c[0]))throw "this only supports TripleDES";o.encryptionSchemeAlg="TripleDES",o.encryptionSchemeIV=i(e,c[1]);var h=n(e,u[0]);if(2!=h.length)throw "malformed format: SEQUENCE(0.0.1.0).items != 2: "+h.length;if("2a864886f70d01050c"!=i(e,h[0]))throw "this only supports pkcs5PBKDF2";var l=n(e,h[1]);if(l.length<2)throw "malformed format: SEQUENCE(0.0.1.0.1).items < 2: "+l.length;o.pbkdf2Salt=i(e,l[0]);var f=i(e,l[1]);try{o.pbkdf2Iter=parseInt(f,16);}catch(t){throw "malformed format pbkdf2Iter: "+f}return o},getPBKDF2KeyHexFromParam:function t(e,r){var n=y.enc.Hex.parse(e.pbkdf2Salt),i=e.pbkdf2Iter,o=y.PBKDF2(r,n,{keySize:6,iterations:i});return y.enc.Hex.stringify(o)},_getPlainPKCS8HexFromEncryptedPKCS8PEM:function t(e,r){var n=qr(e,"ENCRYPTED PRIVATE KEY"),i=this.parseHexOfEncryptedPKCS8(n),o=tn.getPBKDF2KeyHexFromParam(i,r),s={};s.ciphertext=y.enc.Hex.parse(i.ciphertext);var a=y.enc.Hex.parse(o),u=y.enc.Hex.parse(i.encryptionSchemeIV),c=y.TripleDES.decrypt(s,a,{iv:u});return y.enc.Hex.stringify(c)},getKeyFromEncryptedPKCS8PEM:function t(e,r){var n=this._getPlainPKCS8HexFromEncryptedPKCS8PEM(e,r);return this.getKeyFromPlainPrivatePKCS8Hex(n)},parsePlainPrivatePKCS8Hex:function t(e){var r=Ar,n=r.getChildIdx,i=r.getV,o={algparam:null};if("30"!=e.substr(0,2))throw "malformed plain PKCS8 private key(code:001)";var s=n(e,0);if(3!=s.length)throw "malformed plain PKCS8 private key(code:002)";if("30"!=e.substr(s[1],2))throw "malformed PKCS8 private key(code:003)";var a=n(e,s[1]);if(2!=a.length)throw "malformed PKCS8 private key(code:004)";if("06"!=e.substr(a[0],2))throw "malformed PKCS8 private key(code:005)";if(o.algoid=i(e,a[0]),"06"==e.substr(a[1],2)&&(o.algparam=i(e,a[1])),"04"!=e.substr(s[2],2))throw "malformed PKCS8 private key(code:006)";return o.keyidx=r.getVidx(e,s[2]),o},getKeyFromPlainPrivatePKCS8PEM:function t(e){var r=qr(e,"PRIVATE KEY");return this.getKeyFromPlainPrivatePKCS8Hex(r)},getKeyFromPlainPrivatePKCS8Hex:function t(e){var r,n=this.parsePlainPrivatePKCS8Hex(e);if("2a864886f70d010101"==n.algoid)r=new qe;else if("2a8648ce380401"==n.algoid)r=new Er.crypto.DSA;else{if("2a8648ce3d0201"!=n.algoid)throw "unsupported private key algorithm";r=new Er.crypto.ECDSA;}return r.readPKCS8PrvKeyHex(e),r},_getKeyFromPublicPKCS8Hex:function t(e){var r,n=Ar.getVbyList(e,0,[0,0],"06");if("2a864886f70d010101"===n)r=new qe;else if("2a8648ce380401"===n)r=new Er.crypto.DSA;else{if("2a8648ce3d0201"!==n)throw "unsupported PKCS#8 public key hex";r=new Er.crypto.ECDSA;}return r.readPKCS8PubKeyHex(e),r},parsePublicRawRSAKeyHex:function t(e){var r=Ar,n=r.getChildIdx,i=r.getV,o={};if("30"!=e.substr(0,2))throw "malformed RSA key(code:001)";var s=n(e,0);if(2!=s.length)throw "malformed RSA key(code:002)";if("02"!=e.substr(s[0],2))throw "malformed RSA key(code:003)";if(o.n=i(e,s[0]),"02"!=e.substr(s[1],2))throw "malformed RSA key(code:004)";return o.e=i(e,s[1]),o},parsePublicPKCS8Hex:function t(e){var r=Ar,n=r.getChildIdx,i=r.getV,o={algparam:null},s=n(e,0);if(2!=s.length)throw "outer DERSequence shall have 2 elements: "+s.length;var a=s[0];if("30"!=e.substr(a,2))throw "malformed PKCS8 public key(code:001)";var u=n(e,a);if(2!=u.length)throw "malformed PKCS8 public key(code:002)";if("06"!=e.substr(u[0],2))throw "malformed PKCS8 public key(code:003)";if(o.algoid=i(e,u[0]),"06"==e.substr(u[1],2)?o.algparam=i(e,u[1]):"30"==e.substr(u[1],2)&&(o.algparam={},o.algparam.p=r.getVbyList(e,u[1],[0],"02"),o.algparam.q=r.getVbyList(e,u[1],[1],"02"),o.algparam.g=r.getVbyList(e,u[1],[2],"02")),"03"!=e.substr(s[1],2))throw "malformed PKCS8 public key(code:004)";return o.key=i(e,s[1]).substr(2),o}}}();tn.getKey=function(t,e,r){var n=(v=Ar).getChildIdx,i=(v.getV,v.getVbyList),o=Er.crypto,s=o.ECDSA,a=o.DSA,u=qe,c=qr,h=tn;if(void 0!==u&&t instanceof u)return t;if(void 0!==s&&t instanceof s)return t;if(void 0!==a&&t instanceof a)return t;if(void 0!==t.curve&&void 0!==t.xy&&void 0===t.d)return new s({pub:t.xy,curve:t.curve});if(void 0!==t.curve&&void 0!==t.d)return new s({prv:t.d,curve:t.curve});if(void 0===t.kty&&void 0!==t.n&&void 0!==t.e&&void 0===t.d)return (P=new u).setPublic(t.n,t.e),P;if(void 0===t.kty&&void 0!==t.n&&void 0!==t.e&&void 0!==t.d&&void 0!==t.p&&void 0!==t.q&&void 0!==t.dp&&void 0!==t.dq&&void 0!==t.co&&void 0===t.qi)return (P=new u).setPrivateEx(t.n,t.e,t.d,t.p,t.q,t.dp,t.dq,t.co),P;if(void 0===t.kty&&void 0!==t.n&&void 0!==t.e&&void 0!==t.d&&void 0===t.p)return (P=new u).setPrivate(t.n,t.e,t.d),P;if(void 0!==t.p&&void 0!==t.q&&void 0!==t.g&&void 0!==t.y&&void 0===t.x)return (P=new a).setPublic(t.p,t.q,t.g,t.y),P;if(void 0!==t.p&&void 0!==t.q&&void 0!==t.g&&void 0!==t.y&&void 0!==t.x)return (P=new a).setPrivate(t.p,t.q,t.g,t.y,t.x),P;if("RSA"===t.kty&&void 0!==t.n&&void 0!==t.e&&void 0===t.d)return (P=new u).setPublic(Ur(t.n),Ur(t.e)),P;if("RSA"===t.kty&&void 0!==t.n&&void 0!==t.e&&void 0!==t.d&&void 0!==t.p&&void 0!==t.q&&void 0!==t.dp&&void 0!==t.dq&&void 0!==t.qi)return (P=new u).setPrivateEx(Ur(t.n),Ur(t.e),Ur(t.d),Ur(t.p),Ur(t.q),Ur(t.dp),Ur(t.dq),Ur(t.qi)),P;if("RSA"===t.kty&&void 0!==t.n&&void 0!==t.e&&void 0!==t.d)return (P=new u).setPrivate(Ur(t.n),Ur(t.e),Ur(t.d)),P;if("EC"===t.kty&&void 0!==t.crv&&void 0!==t.x&&void 0!==t.y&&void 0===t.d){var l=(A=new s({curve:t.crv})).ecparams.keylen/4,f="04"+("0000000000"+Ur(t.x)).slice(-l)+("0000000000"+Ur(t.y)).slice(-l);return A.setPublicKeyHex(f),A}if("EC"===t.kty&&void 0!==t.crv&&void 0!==t.x&&void 0!==t.y&&void 0!==t.d){l=(A=new s({curve:t.crv})).ecparams.keylen/4,f="04"+("0000000000"+Ur(t.x)).slice(-l)+("0000000000"+Ur(t.y)).slice(-l);var d=("0000000000"+Ur(t.d)).slice(-l);return A.setPublicKeyHex(f),A.setPrivateKeyHex(d),A}if("pkcs5prv"===r){var p,g=t,v=Ar;if(9===(p=n(g,0)).length)(P=new u).readPKCS5PrvKeyHex(g);else if(6===p.length)(P=new a).readPKCS5PrvKeyHex(g);else{if(!(p.length>2&&"04"===g.substr(p[1],2)))throw "unsupported PKCS#1/5 hexadecimal key";(P=new s).readPKCS5PrvKeyHex(g);}return P}if("pkcs8prv"===r)return P=h.getKeyFromPlainPrivatePKCS8Hex(t);if("pkcs8pub"===r)return h._getKeyFromPublicPKCS8Hex(t);if("x509pub"===r)return sn.getPublicKeyFromCertHex(t);if(-1!=t.indexOf("-END CERTIFICATE-",0)||-1!=t.indexOf("-END X509 CERTIFICATE-",0)||-1!=t.indexOf("-END TRUSTED CERTIFICATE-",0))return sn.getPublicKeyFromCertPEM(t);if(-1!=t.indexOf("-END PUBLIC KEY-")){var y=qr(t,"PUBLIC KEY");return h._getKeyFromPublicPKCS8Hex(y)}if(-1!=t.indexOf("-END RSA PRIVATE KEY-")&&-1==t.indexOf("4,ENCRYPTED")){var m=c(t,"RSA PRIVATE KEY");return h.getKey(m,null,"pkcs5prv")}if(-1!=t.indexOf("-END DSA PRIVATE KEY-")&&-1==t.indexOf("4,ENCRYPTED")){var _=i(R=c(t,"DSA PRIVATE KEY"),0,[1],"02"),S=i(R,0,[2],"02"),F=i(R,0,[3],"02"),b=i(R,0,[4],"02"),w=i(R,0,[5],"02");return (P=new a).setPrivate(new E(_,16),new E(S,16),new E(F,16),new E(b,16),new E(w,16)),P}if(-1!=t.indexOf("-END PRIVATE KEY-"))return h.getKeyFromPlainPrivatePKCS8PEM(t);if(-1!=t.indexOf("-END RSA PRIVATE KEY-")&&-1!=t.indexOf("4,ENCRYPTED")){var x=h.getDecryptedKeyHex(t,e),k=new qe;return k.readPKCS5PrvKeyHex(x),k}if(-1!=t.indexOf("-END EC PRIVATE KEY-")&&-1!=t.indexOf("4,ENCRYPTED")){var A,P=i(R=h.getDecryptedKeyHex(t,e),0,[1],"04"),C=i(R,0,[2,0],"06"),T=i(R,0,[3,0],"03").substr(2);if(void 0===Er.crypto.OID.oidhex2name[C])throw "undefined OID(hex) in KJUR.crypto.OID: "+C;return (A=new s({curve:Er.crypto.OID.oidhex2name[C]})).setPublicKeyHex(T),A.setPrivateKeyHex(P),A.isPublic=!1,A}if(-1!=t.indexOf("-END DSA PRIVATE KEY-")&&-1!=t.indexOf("4,ENCRYPTED")){var R;_=i(R=h.getDecryptedKeyHex(t,e),0,[1],"02"),S=i(R,0,[2],"02"),F=i(R,0,[3],"02"),b=i(R,0,[4],"02"),w=i(R,0,[5],"02");return (P=new a).setPrivate(new E(_,16),new E(S,16),new E(F,16),new E(b,16),new E(w,16)),P}if(-1!=t.indexOf("-END ENCRYPTED PRIVATE KEY-"))return h.getKeyFromEncryptedPKCS8PEM(t,e);throw "not supported argument"},tn.generateKeypair=function(t,e){if("RSA"==t){var r=e;(s=new qe).generate(r,"10001"),s.isPrivate=!0,s.isPublic=!0;var n=new qe,i=s.n.toString(16),o=s.e.toString(16);return n.setPublic(i,o),n.isPrivate=!1,n.isPublic=!0,(a={}).prvKeyObj=s,a.pubKeyObj=n,a}if("EC"==t){var s,a,u=e,c=new Er.crypto.ECDSA({curve:u}).generateKeyPairHex();return (s=new Er.crypto.ECDSA({curve:u})).setPublicKeyHex(c.ecpubhex),s.setPrivateKeyHex(c.ecprvhex),s.isPrivate=!0,s.isPublic=!1,(n=new Er.crypto.ECDSA({curve:u})).setPublicKeyHex(c.ecpubhex),n.isPrivate=!1,n.isPublic=!0,(a={}).prvKeyObj=s,a.pubKeyObj=n,a}throw "unknown algorithm: "+t},tn.getPEM=function(t,e,r,n,i,o){var s=Er,a=s.asn1,u=a.DERObjectIdentifier,c=a.DERInteger,h=a.ASN1Util.newObject,l=a.x509.SubjectPublicKeyInfo,f=s.crypto,d=f.DSA,p=f.ECDSA,g=qe;function v(t){return h({seq:[{int:0},{int:{bigint:t.n}},{int:t.e},{int:{bigint:t.d}},{int:{bigint:t.p}},{int:{bigint:t.q}},{int:{bigint:t.dmp1}},{int:{bigint:t.dmq1}},{int:{bigint:t.coeff}}]})}function m(t){return h({seq:[{int:1},{octstr:{hex:t.prvKeyHex}},{tag:["a0",!0,{oid:{name:t.curveName}}]},{tag:["a1",!0,{bitstr:{hex:"00"+t.pubKeyHex}}]}]})}function _(t){return h({seq:[{int:0},{int:{bigint:t.p}},{int:{bigint:t.q}},{int:{bigint:t.g}},{int:{bigint:t.y}},{int:{bigint:t.x}}]})}if((void 0!==g&&t instanceof g||void 0!==d&&t instanceof d||void 0!==p&&t instanceof p)&&1==t.isPublic&&(void 0===e||"PKCS8PUB"==e))return Vr(w=new l(t).getEncodedHex(),"PUBLIC KEY");if("PKCS1PRV"==e&&void 0!==g&&t instanceof g&&(void 0===r||null==r)&&1==t.isPrivate)return Vr(w=v(t).getEncodedHex(),"RSA PRIVATE KEY");if("PKCS1PRV"==e&&void 0!==p&&t instanceof p&&(void 0===r||null==r)&&1==t.isPrivate){var S=new u({name:t.curveName}).getEncodedHex(),F=m(t).getEncodedHex(),b="";return b+=Vr(S,"EC PARAMETERS"),b+=Vr(F,"EC PRIVATE KEY")}if("PKCS1PRV"==e&&void 0!==d&&t instanceof d&&(void 0===r||null==r)&&1==t.isPrivate)return Vr(w=_(t).getEncodedHex(),"DSA PRIVATE KEY");if("PKCS5PRV"==e&&void 0!==g&&t instanceof g&&void 0!==r&&null!=r&&1==t.isPrivate){var w=v(t).getEncodedHex();return void 0===n&&(n="DES-EDE3-CBC"),this.getEncryptedPKCS5PEMFromPrvKeyHex("RSA",w,r,n,o)}if("PKCS5PRV"==e&&void 0!==p&&t instanceof p&&void 0!==r&&null!=r&&1==t.isPrivate){w=m(t).getEncodedHex();return void 0===n&&(n="DES-EDE3-CBC"),this.getEncryptedPKCS5PEMFromPrvKeyHex("EC",w,r,n,o)}if("PKCS5PRV"==e&&void 0!==d&&t instanceof d&&void 0!==r&&null!=r&&1==t.isPrivate){w=_(t).getEncodedHex();return void 0===n&&(n="DES-EDE3-CBC"),this.getEncryptedPKCS5PEMFromPrvKeyHex("DSA",w,r,n,o)}var E=function t(e,r){var n=x(e,r);return new h({seq:[{seq:[{oid:{name:"pkcs5PBES2"}},{seq:[{seq:[{oid:{name:"pkcs5PBKDF2"}},{seq:[{octstr:{hex:n.pbkdf2Salt}},{int:n.pbkdf2Iter}]}]},{seq:[{oid:{name:"des-EDE3-CBC"}},{octstr:{hex:n.encryptionSchemeIV}}]}]}]},{octstr:{hex:n.ciphertext}}]}).getEncodedHex()},x=function t(e,r){var n=y.lib.WordArray.random(8),i=y.lib.WordArray.random(8),o=y.PBKDF2(r,n,{keySize:6,iterations:100}),s=y.enc.Hex.parse(e),a=y.TripleDES.encrypt(s,o,{iv:i})+"",u={};return u.ciphertext=a,u.pbkdf2Salt=y.enc.Hex.stringify(n),u.pbkdf2Iter=100,u.encryptionSchemeAlg="DES-EDE3-CBC",u.encryptionSchemeIV=y.enc.Hex.stringify(i),u};if("PKCS8PRV"==e&&void 0!=g&&t instanceof g&&1==t.isPrivate){var k=v(t).getEncodedHex();w=h({seq:[{int:0},{seq:[{oid:{name:"rsaEncryption"}},{null:!0}]},{octstr:{hex:k}}]}).getEncodedHex();return void 0===r||null==r?Vr(w,"PRIVATE KEY"):Vr(F=E(w,r),"ENCRYPTED PRIVATE KEY")}if("PKCS8PRV"==e&&void 0!==p&&t instanceof p&&1==t.isPrivate){k=new h({seq:[{int:1},{octstr:{hex:t.prvKeyHex}},{tag:["a1",!0,{bitstr:{hex:"00"+t.pubKeyHex}}]}]}).getEncodedHex(),w=h({seq:[{int:0},{seq:[{oid:{name:"ecPublicKey"}},{oid:{name:t.curveName}}]},{octstr:{hex:k}}]}).getEncodedHex();return void 0===r||null==r?Vr(w,"PRIVATE KEY"):Vr(F=E(w,r),"ENCRYPTED PRIVATE KEY")}if("PKCS8PRV"==e&&void 0!==d&&t instanceof d&&1==t.isPrivate){k=new c({bigint:t.x}).getEncodedHex(),w=h({seq:[{int:0},{seq:[{oid:{name:"dsa"}},{seq:[{int:{bigint:t.p}},{int:{bigint:t.q}},{int:{bigint:t.g}}]}]},{octstr:{hex:k}}]}).getEncodedHex();return void 0===r||null==r?Vr(w,"PRIVATE KEY"):Vr(F=E(w,r),"ENCRYPTED PRIVATE KEY")}throw "unsupported object nor format"},tn.getKeyFromCSRPEM=function(t){var e=qr(t,"CERTIFICATE REQUEST");return tn.getKeyFromCSRHex(e)},tn.getKeyFromCSRHex=function(t){var e=tn.parseCSRHex(t);return tn.getKey(e.p8pubkeyhex,null,"pkcs8pub")},tn.parseCSRHex=function(t){var e=Ar,r=e.getChildIdx,n=e.getTLV,i={},o=t;if("30"!=o.substr(0,2))throw "malformed CSR(code:001)";var s=r(o,0);if(s.length<1)throw "malformed CSR(code:002)";if("30"!=o.substr(s[0],2))throw "malformed CSR(code:003)";var a=r(o,s[0]);if(a.length<3)throw "malformed CSR(code:004)";return i.p8pubkeyhex=n(o,a[2]),i},tn.getJWKFromKey=function(t){var e={};if(t instanceof qe&&t.isPrivate)return e.kty="RSA",e.n=Lr(t.n.toString(16)),e.e=Lr(t.e.toString(16)),e.d=Lr(t.d.toString(16)),e.p=Lr(t.p.toString(16)),e.q=Lr(t.q.toString(16)),e.dp=Lr(t.dmp1.toString(16)),e.dq=Lr(t.dmq1.toString(16)),e.qi=Lr(t.coeff.toString(16)),e;if(t instanceof qe&&t.isPublic)return e.kty="RSA",e.n=Lr(t.n.toString(16)),e.e=Lr(t.e.toString(16)),e;if(t instanceof Er.crypto.ECDSA&&t.isPrivate){if("P-256"!==(n=t.getShortNISTPCurveName())&&"P-384"!==n)throw "unsupported curve name for JWT: "+n;var r=t.getPublicKeyXYHex();return e.kty="EC",e.crv=n,e.x=Lr(r.x),e.y=Lr(r.y),e.d=Lr(t.prvKeyHex),e}if(t instanceof Er.crypto.ECDSA&&t.isPublic){var n;if("P-256"!==(n=t.getShortNISTPCurveName())&&"P-384"!==n)throw "unsupported curve name for JWT: "+n;r=t.getPublicKeyXYHex();return e.kty="EC",e.crv=n,e.x=Lr(r.x),e.y=Lr(r.y),e}throw "not supported key object"},qe.getPosArrayOfChildrenFromHex=function(t){return Ar.getChildIdx(t,0)},qe.getHexValueArrayOfChildrenFromHex=function(t){var e,r=Ar.getV,n=r(t,(e=qe.getPosArrayOfChildrenFromHex(t))[0]),i=r(t,e[1]),o=r(t,e[2]),s=r(t,e[3]),a=r(t,e[4]),u=r(t,e[5]),c=r(t,e[6]),h=r(t,e[7]),l=r(t,e[8]);return (e=new Array).push(n,i,o,s,a,u,c,h,l),e},qe.prototype.readPrivateKeyFromPEMString=function(t){var e=qr(t),r=qe.getHexValueArrayOfChildrenFromHex(e);this.setPrivateEx(r[1],r[2],r[3],r[4],r[5],r[6],r[7],r[8]);},qe.prototype.readPKCS5PrvKeyHex=function(t){var e=qe.getHexValueArrayOfChildrenFromHex(t);this.setPrivateEx(e[1],e[2],e[3],e[4],e[5],e[6],e[7],e[8]);},qe.prototype.readPKCS8PrvKeyHex=function(t){var e,r,n,i,o,s,a,u,c=Ar,h=c.getVbyList;if(!1===c.isASN1HEX(t))throw "not ASN.1 hex string";try{e=h(t,0,[2,0,1],"02"),r=h(t,0,[2,0,2],"02"),n=h(t,0,[2,0,3],"02"),i=h(t,0,[2,0,4],"02"),o=h(t,0,[2,0,5],"02"),s=h(t,0,[2,0,6],"02"),a=h(t,0,[2,0,7],"02"),u=h(t,0,[2,0,8],"02");}catch(t){throw "malformed PKCS#8 plain RSA private key"}this.setPrivateEx(e,r,n,i,o,s,a,u);},qe.prototype.readPKCS5PubKeyHex=function(t){var e=Ar,r=e.getV;if(!1===e.isASN1HEX(t))throw "keyHex is not ASN.1 hex string";var n=e.getChildIdx(t,0);if(2!==n.length||"02"!==t.substr(n[0],2)||"02"!==t.substr(n[1],2))throw "wrong hex for PKCS#5 public key";var i=r(t,n[0]),o=r(t,n[1]);this.setPublic(i,o);},qe.prototype.readPKCS8PubKeyHex=function(t){var e=Ar;if(!1===e.isASN1HEX(t))throw "not ASN.1 hex string";if("06092a864886f70d010101"!==e.getTLVbyList(t,0,[0,0]))throw "not PKCS8 RSA public key";var r=e.getTLVbyList(t,0,[1,0]);this.readPKCS5PubKeyHex(r);},qe.prototype.readCertPubKeyHex=function(t,e){var r,n;(r=new sn).readCertHex(t),n=r.getPublicKeyHex(),this.readPKCS8PubKeyHex(n);};var en=new RegExp("");function rn(t,e){for(var r="",n=e/4-t.length,i=0;i<n;i++)r+="0";return r+t}function nn(t,e,r){for(var n="",i=0;n.length<e;)n+=Or(r(jr(t+String.fromCharCode.apply(String,[(4278190080&i)>>24,(16711680&i)>>16,(65280&i)>>8,255&i])))),i+=1;return n}function on(t){for(var e in Er.crypto.Util.DIGESTINFOHEAD){var r=Er.crypto.Util.DIGESTINFOHEAD[e],n=r.length;if(t.substring(0,n)==r)return [e,t.substring(n)]}return []}function sn(){var t=Ar,e=t.getChildIdx,r=t.getV,n=t.getTLV,i=t.getVbyList,o=t.getTLVbyList,s=t.getIdxbyList,a=t.getVidx,u=t.oidname,c=sn,h=qr;this.hex=null,this.version=0,this.foffset=0,this.aExtInfo=null,this.getVersion=function(){return null===this.hex||0!==this.version?this.version:"a003020102"!==o(this.hex,0,[0,0])?(this.version=1,this.foffset=-1,1):(this.version=3,3)},this.getSerialNumberHex=function(){return i(this.hex,0,[0,1+this.foffset],"02")},this.getSignatureAlgorithmField=function(){return u(i(this.hex,0,[0,2+this.foffset,0],"06"))},this.getIssuerHex=function(){return o(this.hex,0,[0,3+this.foffset],"30")},this.getIssuerString=function(){return c.hex2dn(this.getIssuerHex())},this.getSubjectHex=function(){return o(this.hex,0,[0,5+this.foffset],"30")},this.getSubjectString=function(){return c.hex2dn(this.getSubjectHex())},this.getNotBefore=function(){var t=i(this.hex,0,[0,4+this.foffset,0]);return t=t.replace(/(..)/g,"%$1"),t=decodeURIComponent(t)},this.getNotAfter=function(){var t=i(this.hex,0,[0,4+this.foffset,1]);return t=t.replace(/(..)/g,"%$1"),t=decodeURIComponent(t)},this.getPublicKeyHex=function(){return t.getTLVbyList(this.hex,0,[0,6+this.foffset],"30")},this.getPublicKeyIdx=function(){return s(this.hex,0,[0,6+this.foffset],"30")},this.getPublicKeyContentIdx=function(){var t=this.getPublicKeyIdx();return s(this.hex,t,[1,0],"30")},this.getPublicKey=function(){return tn.getKey(this.getPublicKeyHex(),null,"pkcs8pub")},this.getSignatureAlgorithmName=function(){return u(i(this.hex,0,[1,0],"06"))},this.getSignatureValueHex=function(){return i(this.hex,0,[2],"03",!0)},this.verifySignature=function(t){var e=this.getSignatureAlgorithmName(),r=this.getSignatureValueHex(),n=o(this.hex,0,[0],"30"),i=new Er.crypto.Signature({alg:e});return i.init(t),i.updateHex(n),i.verify(r)},this.parseExt=function(){if(3!==this.version)return -1;var r=s(this.hex,0,[0,7,0],"30"),n=e(this.hex,r);this.aExtInfo=new Array;for(var o=0;o<n.length;o++){var u={critical:!1},c=0;3===e(this.hex,n[o]).length&&(u.critical=!0,c=1),u.oid=t.hextooidstr(i(this.hex,n[o],[0],"06"));var h=s(this.hex,n[o],[1+c]);u.vidx=a(this.hex,h),this.aExtInfo.push(u);}},this.getExtInfo=function(t){var e=this.aExtInfo,r=t;if(t.match(/^[0-9.]+$/)||(r=Er.asn1.x509.OID.name2oid(t)),""!==r)for(var n=0;n<e.length;n++)if(e[n].oid===r)return e[n]},this.getExtBasicConstraints=function(){var t=this.getExtInfo("basicConstraints");if(void 0===t)return t;var e=r(this.hex,t.vidx);if(""===e)return {};if("0101ff"===e)return {cA:!0};if("0101ff02"===e.substr(0,8)){var n=r(e,6);return {cA:!0,pathLen:parseInt(n,16)}}throw "basicConstraints parse error"},this.getExtKeyUsageBin=function(){var t=this.getExtInfo("keyUsage");if(void 0===t)return "";var e=r(this.hex,t.vidx);if(e.length%2!=0||e.length<=2)throw "malformed key usage value";var n=parseInt(e.substr(0,2)),i=parseInt(e.substr(2),16).toString(2);return i.substr(0,i.length-n)},this.getExtKeyUsageString=function(){for(var t=this.getExtKeyUsageBin(),e=new Array,r=0;r<t.length;r++)"1"==t.substr(r,1)&&e.push(sn.KEYUSAGE_NAME[r]);return e.join(",")},this.getExtSubjectKeyIdentifier=function(){var t=this.getExtInfo("subjectKeyIdentifier");return void 0===t?t:r(this.hex,t.vidx)},this.getExtAuthorityKeyIdentifier=function(){var t=this.getExtInfo("authorityKeyIdentifier");if(void 0===t)return t;for(var i={},o=n(this.hex,t.vidx),s=e(o,0),a=0;a<s.length;a++)"80"===o.substr(s[a],2)&&(i.kid=r(o,s[a]));return i},this.getExtExtKeyUsageName=function(){var t=this.getExtInfo("extKeyUsage");if(void 0===t)return t;var i=new Array,o=n(this.hex,t.vidx);if(""===o)return i;for(var s=e(o,0),a=0;a<s.length;a++)i.push(u(r(o,s[a])));return i},this.getExtSubjectAltName=function(){for(var t=this.getExtSubjectAltName2(),e=new Array,r=0;r<t.length;r++)"DNS"===t[r][0]&&e.push(t[r][1]);return e},this.getExtSubjectAltName2=function(){var t,i,o,s=this.getExtInfo("subjectAltName");if(void 0===s)return s;for(var a=new Array,u=n(this.hex,s.vidx),c=e(u,0),h=0;h<c.length;h++)o=u.substr(c[h],2),t=r(u,c[h]),"81"===o&&(i=Nr(t),a.push(["MAIL",i])),"82"===o&&(i=Nr(t),a.push(["DNS",i])),"84"===o&&(i=sn.hex2dn(t,0),a.push(["DN",i])),"86"===o&&(i=Nr(t),a.push(["URI",i])),"87"===o&&(i=Qr(t),a.push(["IP",i]));return a},this.getExtCRLDistributionPointsURI=function(){var t=this.getExtInfo("cRLDistributionPoints");if(void 0===t)return t;for(var r=new Array,n=e(this.hex,t.vidx),o=0;o<n.length;o++)try{var s=Nr(i(this.hex,n[o],[0,0,0],"86"));r.push(s);}catch(t){}return r},this.getExtAIAInfo=function(){var t=this.getExtInfo("authorityInfoAccess");if(void 0===t)return t;for(var r={ocsp:[],caissuer:[]},n=e(this.hex,t.vidx),o=0;o<n.length;o++){var s=i(this.hex,n[o],[0],"06"),a=i(this.hex,n[o],[1],"86");"2b06010505073001"===s&&r.ocsp.push(Nr(a)),"2b06010505073002"===s&&r.caissuer.push(Nr(a));}return r},this.getExtCertificatePolicies=function(){var t=this.getExtInfo("certificatePolicies");if(void 0===t)return t;for(var o=n(this.hex,t.vidx),s=[],a=e(o,0),c=0;c<a.length;c++){var h={},l=e(o,a[c]);if(h.id=u(r(o,l[0])),2===l.length)for(var f=e(o,l[1]),d=0;d<f.length;d++){var p=i(o,f[d],[0],"06");"2b06010505070201"===p?h.cps=Nr(i(o,f[d],[1])):"2b06010505070202"===p&&(h.unotice=Nr(i(o,f[d],[1,0])));}s.push(h);}return s},this.readCertPEM=function(t){this.readCertHex(h(t));},this.readCertHex=function(t){this.hex=t,this.getVersion();try{s(this.hex,0,[0,7],"a3"),this.parseExt();}catch(t){}},this.getInfo=function(){var t,e,r;if(t="Basic Fields\n",t+="  serial number: "+this.getSerialNumberHex()+"\n",t+="  signature algorithm: "+this.getSignatureAlgorithmField()+"\n",t+="  issuer: "+this.getIssuerString()+"\n",t+="  notBefore: "+this.getNotBefore()+"\n",t+="  notAfter: "+this.getNotAfter()+"\n",t+="  subject: "+this.getSubjectString()+"\n",t+="  subject public key info: \n",t+="    key algorithm: "+(e=this.getPublicKey()).type+"\n","RSA"===e.type&&(t+="    n="+Zr(e.n.toString(16)).substr(0,16)+"...\n",t+="    e="+Zr(e.e.toString(16))+"\n"),void 0!==(r=this.aExtInfo)&&null!==r){t+="X509v3 Extensions:\n";for(var n=0;n<r.length;n++){var i=r[n],o=Er.asn1.x509.OID.oid2name(i.oid);""===o&&(o=i.oid);var s="";if(!0===i.critical&&(s="CRITICAL"),t+="  "+o+" "+s+":\n","basicConstraints"===o){var a=this.getExtBasicConstraints();void 0===a.cA?t+="    {}\n":(t+="    cA=true",void 0!==a.pathLen&&(t+=", pathLen="+a.pathLen),t+="\n");}else if("keyUsage"===o)t+="    "+this.getExtKeyUsageString()+"\n";else if("subjectKeyIdentifier"===o)t+="    "+this.getExtSubjectKeyIdentifier()+"\n";else if("authorityKeyIdentifier"===o){var u=this.getExtAuthorityKeyIdentifier();void 0!==u.kid&&(t+="    kid="+u.kid+"\n");}else{if("extKeyUsage"===o)t+="    "+this.getExtExtKeyUsageName().join(", ")+"\n";else if("subjectAltName"===o)t+="    "+this.getExtSubjectAltName2()+"\n";else if("cRLDistributionPoints"===o)t+="    "+this.getExtCRLDistributionPointsURI()+"\n";else if("authorityInfoAccess"===o){var c=this.getExtAIAInfo();void 0!==c.ocsp&&(t+="    ocsp: "+c.ocsp.join(",")+"\n"),void 0!==c.caissuer&&(t+="    caissuer: "+c.caissuer.join(",")+"\n");}else if("certificatePolicies"===o)for(var h=this.getExtCertificatePolicies(),l=0;l<h.length;l++)void 0!==h[l].id&&(t+="    policy oid: "+h[l].id+"\n"),void 0!==h[l].cps&&(t+="    cps: "+h[l].cps+"\n");}}}return t+="signature algorithm: "+this.getSignatureAlgorithmName()+"\n",t+="signature: "+this.getSignatureValueHex().substr(0,16)+"...\n"};}en.compile("[^0-9a-f]","gi"),qe.prototype.sign=function(t,e){var r=function t(r){return Er.crypto.Util.hashString(r,e)}(t);return this.signWithMessageHash(r,e)},qe.prototype.signWithMessageHash=function(t,e){var r=Ke(Er.crypto.Util.getPaddedDigestInfoHex(t,e,this.n.bitLength()),16);return rn(this.doPrivate(r).toString(16),this.n.bitLength())},qe.prototype.signPSS=function(t,e,r){var n=function t(r){return Er.crypto.Util.hashHex(r,e)}(jr(t));return void 0===r&&(r=-1),this.signWithMessageHashPSS(n,e,r)},qe.prototype.signWithMessageHashPSS=function(t,e,r){var n,i=Or(t),o=i.length,s=this.n.bitLength()-1,a=Math.ceil(s/8),u=function t(r){return Er.crypto.Util.hashHex(r,e)};if(-1===r||void 0===r)r=o;else if(-2===r)r=a-o-2;else if(r<-2)throw "invalid salt length";if(a<o+r+2)throw "data too long";var c="";r>0&&(c=new Array(r),(new Me).nextBytes(c),c=String.fromCharCode.apply(String,c));var h=Or(u(jr("\0\0\0\0\0\0\0\0"+i+c))),l=[];for(n=0;n<a-r-o-2;n+=1)l[n]=0;var f=String.fromCharCode.apply(String,l)+""+c,d=nn(h,f.length,u),p=[];for(n=0;n<f.length;n+=1)p[n]=f.charCodeAt(n)^d.charCodeAt(n);var g=65280>>8*a-s&255;for(p[0]&=~g,n=0;n<o;n++)p.push(h.charCodeAt(n));return p.push(188),rn(this.doPrivate(new E(p)).toString(16),this.n.bitLength())},qe.prototype.verify=function(t,e){var r=Ke(e=(e=e.replace(en,"")).replace(/[ \n]+/g,""),16);if(r.bitLength()>this.n.bitLength())return 0;var n=on(this.doPublic(r).toString(16).replace(/^1f+00/,""));if(0==n.length)return !1;var i=n[0];return n[1]==function t(e){return Er.crypto.Util.hashString(e,i)}(t)},qe.prototype.verifyWithMessageHash=function(t,e){var r=Ke(e=(e=e.replace(en,"")).replace(/[ \n]+/g,""),16);if(r.bitLength()>this.n.bitLength())return 0;var n=on(this.doPublic(r).toString(16).replace(/^1f+00/,""));if(0==n.length)return !1;n[0];return n[1]==t},qe.prototype.verifyPSS=function(t,e,r,n){var i=function t(e){return Er.crypto.Util.hashHex(e,r)}(jr(t));return void 0===n&&(n=-1),this.verifyWithMessageHashPSS(i,e,r,n)},qe.prototype.verifyWithMessageHashPSS=function(t,e,r,n){var i=new E(e,16);if(i.bitLength()>this.n.bitLength())return !1;var o,s=function t(e){return Er.crypto.Util.hashHex(e,r)},a=Or(t),u=a.length,c=this.n.bitLength()-1,h=Math.ceil(c/8);if(-1===n||void 0===n)n=u;else if(-2===n)n=h-u-2;else if(n<-2)throw "invalid salt length";if(h<u+n+2)throw "data too long";var l=this.doPublic(i).toByteArray();for(o=0;o<l.length;o+=1)l[o]&=255;for(;l.length<h;)l.unshift(0);if(188!==l[h-1])throw "encoded message does not end in 0xbc";var f=(l=String.fromCharCode.apply(String,l)).substr(0,h-u-1),d=l.substr(f.length,u),p=65280>>8*h-c&255;if(0!=(f.charCodeAt(0)&p))throw "bits beyond keysize not zero";var g=nn(d,f.length,s),v=[];for(o=0;o<f.length;o+=1)v[o]=f.charCodeAt(o)^g.charCodeAt(o);v[0]&=~p;var y=h-u-n-2;for(o=0;o<y;o+=1)if(0!==v[o])throw "leftmost octets not zero";if(1!==v[y])throw "0x01 marker not found";return d===Or(s(jr("\0\0\0\0\0\0\0\0"+a+String.fromCharCode.apply(String,v.slice(-n)))))},qe.SALT_LEN_HLEN=-1,qe.SALT_LEN_MAX=-2,qe.SALT_LEN_RECOVER=-2,sn.hex2dn=function(t,e){if(void 0===e&&(e=0),"30"!==t.substr(e,2))throw "malformed DN";for(var r=new Array,n=Ar.getChildIdx(t,e),i=0;i<n.length;i++)r.push(sn.hex2rdn(t,n[i]));return "/"+(r=r.map(function(t){return t.replace("/","\\/")})).join("/")},sn.hex2rdn=function(t,e){if(void 0===e&&(e=0),"31"!==t.substr(e,2))throw "malformed RDN";for(var r=new Array,n=Ar.getChildIdx(t,e),i=0;i<n.length;i++)r.push(sn.hex2attrTypeValue(t,n[i]));return (r=r.map(function(t){return t.replace("+","\\+")})).join("+")},sn.hex2attrTypeValue=function(t,e){var r=Ar,n=r.getV;if(void 0===e&&(e=0),"30"!==t.substr(e,2))throw "malformed attribute type and value";var i=r.getChildIdx(t,e);2!==i.length||t.substr(i[0],2);var o=n(t,i[0]),s=Er.asn1.ASN1Util.oidHexToInt(o);return Er.asn1.x509.OID.oid2atype(s)+"="+Or(n(t,i[1]))},sn.getPublicKeyFromCertHex=function(t){var e=new sn;return e.readCertHex(t),e.getPublicKey()},sn.getPublicKeyFromCertPEM=function(t){var e=new sn;return e.readCertPEM(t),e.getPublicKey()},sn.getPublicKeyInfoPropOfCertPEM=function(t){var e,r,n=Ar.getVbyList,i={};return i.algparam=null,(e=new sn).readCertPEM(t),r=e.getPublicKeyHex(),i.keyhex=n(r,0,[1],"03").substr(2),i.algoid=n(r,0,[0,0],"06"),"2a8648ce3d0201"===i.algoid&&(i.algparam=n(r,0,[0,1],"06")),i},sn.KEYUSAGE_NAME=["digitalSignature","nonRepudiation","keyEncipherment","dataEncipherment","keyAgreement","keyCertSign","cRLSign","encipherOnly","decipherOnly"],void 0!==Er&&Er||(e.KJUR=Er={}),void 0!==Er.jws&&Er.jws||(Er.jws={}),Er.jws.JWS=function(){var t=Er.jws.JWS.isSafeJSONString;this.parseJWS=function(e,r){if(void 0===this.parsedJWS||!r&&void 0===this.parsedJWS.sigvalH){var n=e.match(/^([^.]+)\.([^.]+)\.([^.]+)$/);if(null==n)throw "JWS signature is not a form of 'Head.Payload.SigValue'.";var i=n[1],o=n[2],s=n[3],a=i+"."+o;if(this.parsedJWS={},this.parsedJWS.headB64U=i,this.parsedJWS.payloadB64U=o,this.parsedJWS.sigvalB64U=s,this.parsedJWS.si=a,!r){var u=Ur(s),c=Ke(u,16);this.parsedJWS.sigvalH=u,this.parsedJWS.sigvalBI=c;}var h=kr(i),l=kr(o);if(this.parsedJWS.headS=h,this.parsedJWS.payloadS=l,!t(h,this.parsedJWS,"headP"))throw "malformed JSON string for JWS Head: "+h}};},Er.jws.JWS.sign=function(t,e,n,i,o){var s,a,u,c=Er,h=c.jws.JWS,l=h.readSafeJSONString,f=h.isSafeJSONString,d=c.crypto,p=(d.ECDSA,d.Mac),g=d.Signature,v=JSON;if("string"!=typeof e&&"object"!=(void 0===e?"undefined":r(e)))throw "spHeader must be JSON string or object: "+e;if("object"==(void 0===e?"undefined":r(e))&&(a=e,s=v.stringify(a)),"string"==typeof e){if(!f(s=e))throw "JWS Head is not safe JSON string: "+s;a=l(s);}if(u=n,"object"==(void 0===n?"undefined":r(n))&&(u=v.stringify(n)),""!=t&&null!=t||void 0===a.alg||(t=a.alg),""!=t&&null!=t&&void 0===a.alg&&(a.alg=t,s=v.stringify(a)),t!==a.alg)throw "alg and sHeader.alg doesn't match: "+t+"!="+a.alg;var y=null;if(void 0===h.jwsalg2sigalg[t])throw "unsupported alg name: "+t;y=h.jwsalg2sigalg[t];var m=xr(s)+"."+xr(u),_="";if("Hmac"==y.substr(0,4)){if(void 0===i)throw "mac key shall be specified for HS* alg";var S=new p({alg:y,prov:"cryptojs",pass:i});S.updateString(m),_=S.doFinal();}else{var F;if(-1!=y.indexOf("withECDSA"))(F=new g({alg:y})).init(i,o),F.updateString(m),hASN1Sig=F.sign(),_=Er.crypto.ECDSA.asn1SigToConcatSig(hASN1Sig);else if("none"!=y)(F=new g({alg:y})).init(i,o),F.updateString(m),_=F.sign();}return m+"."+Lr(_)},Er.jws.JWS.verify=function(t,e,n){var i,o=Er,s=o.jws.JWS,a=s.readSafeJSONString,u=o.crypto,c=u.ECDSA,h=u.Mac,l=u.Signature;void 0!==r(qe)&&(i=qe);var f=t.split(".");if(3!==f.length)return !1;var d=f[0]+"."+f[1],p=Ur(f[2]),g=a(kr(f[0])),v=null,y=null;if(void 0===g.alg)throw "algorithm not specified in header";if((y=(v=g.alg).substr(0,2),null!=n&&"[object Array]"===Object.prototype.toString.call(n)&&n.length>0)&&-1==(":"+n.join(":")+":").indexOf(":"+v+":"))throw "algorithm '"+v+"' not accepted in the list";if("none"!=v&&null===e)throw "key shall be specified to verify.";if("string"==typeof e&&-1!=e.indexOf("-----BEGIN ")&&(e=tn.getKey(e)),!("RS"!=y&&"PS"!=y||e instanceof i))throw "key shall be a RSAKey obj for RS* and PS* algs";if("ES"==y&&!(e instanceof c))throw "key shall be a ECDSA obj for ES* algs";var m=null;if(void 0===s.jwsalg2sigalg[g.alg])throw "unsupported alg name: "+v;if("none"==(m=s.jwsalg2sigalg[v]))throw "not supported";if("Hmac"==m.substr(0,4)){if(void 0===e)throw "hexadecimal key shall be specified for HMAC";var _=new h({alg:m,pass:e});return _.updateString(d),p==_.doFinal()}if(-1!=m.indexOf("withECDSA")){var S,F=null;try{F=c.concatSigToASN1Sig(p);}catch(t){return !1}return (S=new l({alg:m})).init(e),S.updateString(d),S.verify(F)}return (S=new l({alg:m})).init(e),S.updateString(d),S.verify(p)},Er.jws.JWS.parse=function(t){var e,r,n,i=t.split("."),o={};if(2!=i.length&&3!=i.length)throw "malformed sJWS: wrong number of '.' splitted elements";return e=i[0],r=i[1],3==i.length&&(n=i[2]),o.headerObj=Er.jws.JWS.readSafeJSONString(kr(e)),o.payloadObj=Er.jws.JWS.readSafeJSONString(kr(r)),o.headerPP=JSON.stringify(o.headerObj,null,"  "),null==o.payloadObj?o.payloadPP=kr(r):o.payloadPP=JSON.stringify(o.payloadObj,null,"  "),void 0!==n&&(o.sigHex=Ur(n)),o},Er.jws.JWS.verifyJWT=function(t,e,n){var i=Er.jws,o=i.JWS,s=o.readSafeJSONString,a=o.inArray,u=o.includedArray,c=t.split("."),h=c[0],l=c[1],f=(Ur(c[2]),s(kr(h))),d=s(kr(l));if(void 0===f.alg)return !1;if(void 0===n.alg)throw "acceptField.alg shall be specified";if(!a(f.alg,n.alg))return !1;if(void 0!==d.iss&&"object"===r(n.iss)&&!a(d.iss,n.iss))return !1;if(void 0!==d.sub&&"object"===r(n.sub)&&!a(d.sub,n.sub))return !1;if(void 0!==d.aud&&"object"===r(n.aud))if("string"==typeof d.aud){if(!a(d.aud,n.aud))return !1}else if("object"==r(d.aud)&&!u(d.aud,n.aud))return !1;var p=i.IntDate.getNow();return void 0!==n.verifyAt&&"number"==typeof n.verifyAt&&(p=n.verifyAt),void 0!==n.gracePeriod&&"number"==typeof n.gracePeriod||(n.gracePeriod=0),!(void 0!==d.exp&&"number"==typeof d.exp&&d.exp+n.gracePeriod<p)&&(!(void 0!==d.nbf&&"number"==typeof d.nbf&&p<d.nbf-n.gracePeriod)&&(!(void 0!==d.iat&&"number"==typeof d.iat&&p<d.iat-n.gracePeriod)&&((void 0===d.jti||void 0===n.jti||d.jti===n.jti)&&!!o.verify(t,e,n.alg))))},Er.jws.JWS.includedArray=function(t,e){var n=Er.jws.JWS.inArray;if(null===t)return !1;if("object"!==(void 0===t?"undefined":r(t)))return !1;if("number"!=typeof t.length)return !1;for(var i=0;i<t.length;i++)if(!n(t[i],e))return !1;return !0},Er.jws.JWS.inArray=function(t,e){if(null===e)return !1;if("object"!==(void 0===e?"undefined":r(e)))return !1;if("number"!=typeof e.length)return !1;for(var n=0;n<e.length;n++)if(e[n]==t)return !0;return !1},Er.jws.JWS.jwsalg2sigalg={HS256:"HmacSHA256",HS384:"HmacSHA384",HS512:"HmacSHA512",RS256:"SHA256withRSA",RS384:"SHA384withRSA",RS512:"SHA512withRSA",ES256:"SHA256withECDSA",ES384:"SHA384withECDSA",PS256:"SHA256withRSAandMGF1",PS384:"SHA384withRSAandMGF1",PS512:"SHA512withRSAandMGF1",none:"none"},Er.jws.JWS.isSafeJSONString=function(t,e,n){var i=null;try{return "object"!=(void 0===(i=wr(t))?"undefined":r(i))?0:i.constructor===Array?0:(e&&(e[n]=i),1)}catch(t){return 0}},Er.jws.JWS.readSafeJSONString=function(t){var e=null;try{return "object"!=(void 0===(e=wr(t))?"undefined":r(e))?null:e.constructor===Array?null:e}catch(t){return null}},Er.jws.JWS.getEncodedSignatureValueFromJWS=function(t){var e=t.match(/^[^.]+\.[^.]+\.([^.]+)$/);if(null==e)throw "JWS signature is not a form of 'Head.Payload.SigValue'.";return e[1]},Er.jws.JWS.getJWKthumbprint=function(t){if("RSA"!==t.kty&&"EC"!==t.kty&&"oct"!==t.kty)throw "unsupported algorithm for JWK Thumprint";var e="{";if("RSA"===t.kty){if("string"!=typeof t.n||"string"!=typeof t.e)throw "wrong n and e value for RSA key";e+='"e":"'+t.e+'",',e+='"kty":"'+t.kty+'",',e+='"n":"'+t.n+'"}';}else if("EC"===t.kty){if("string"!=typeof t.crv||"string"!=typeof t.x||"string"!=typeof t.y)throw "wrong crv, x and y value for EC key";e+='"crv":"'+t.crv+'",',e+='"kty":"'+t.kty+'",',e+='"x":"'+t.x+'",',e+='"y":"'+t.y+'"}';}else if("oct"===t.kty){if("string"!=typeof t.k)throw "wrong k value for oct(symmetric) key";e+='"kty":"'+t.kty+'",',e+='"k":"'+t.k+'"}';}var r=jr(e);return Lr(Er.crypto.Util.hashHex(r,"sha256"))},Er.jws.IntDate={},Er.jws.IntDate.get=function(t){var e=Er.jws.IntDate,r=e.getNow,n=e.getZulu;if("now"==t)return r();if("now + 1hour"==t)return r()+3600;if("now + 1day"==t)return r()+86400;if("now + 1month"==t)return r()+2592e3;if("now + 1year"==t)return r()+31536e3;if(t.match(/Z$/))return n(t);if(t.match(/^[0-9]+$/))return parseInt(t);throw "unsupported format: "+t},Er.jws.IntDate.getZulu=function(t){return Wr(t)},Er.jws.IntDate.getNow=function(){return ~~(new Date/1e3)},Er.jws.IntDate.intDate2UTCString=function(t){return new Date(1e3*t).toUTCString()},Er.jws.IntDate.intDate2Zulu=function(t){var e=new Date(1e3*t);return ("0000"+e.getUTCFullYear()).slice(-4)+("00"+(e.getUTCMonth()+1)).slice(-2)+("00"+e.getUTCDate()).slice(-2)+("00"+e.getUTCHours()).slice(-2)+("00"+e.getUTCMinutes()).slice(-2)+("00"+e.getUTCSeconds()).slice(-2)+"Z"},e.SecureRandom=Me,e.rng_seed_time=Ue,e.BigInteger=E,e.RSAKey=qe;var an=Er.crypto.EDSA;e.EDSA=an;var un=Er.crypto.DSA;e.DSA=un;var cn=Er.crypto.Signature;e.Signature=cn;var hn=Er.crypto.MessageDigest;e.MessageDigest=hn;var ln=Er.crypto.Mac;e.Mac=ln;var fn=Er.crypto.Cipher;e.Cipher=fn,e.KEYUTIL=tn,e.ASN1HEX=Ar,e.X509=sn,e.CryptoJS=y,e.b64tohex=b,e.b64toBA=w,e.stoBA=Pr,e.BAtos=Cr,e.BAtohex=Tr,e.stohex=Rr,e.stob64=function dn(t){return F(Rr(t))},e.stob64u=function pn(t){return Ir(F(Rr(t)))},e.b64utos=function gn(t){return Cr(w(Dr(t)))},e.b64tob64u=Ir,e.b64utob64=Dr,e.hex2b64=F,e.hextob64u=Lr,e.b64utohex=Ur,e.utf8tob64u=xr,e.b64utoutf8=kr,e.utf8tob64=function vn(t){return F(zr($r(t)))},e.b64toutf8=function yn(t){return decodeURIComponent(Yr(b(t)))},e.utf8tohex=Br,e.hextoutf8=Nr,e.hextorstr=Or,e.rstrtohex=jr,e.hextob64=Hr,e.hextob64nl=Mr,e.b64nltohex=Kr,e.hextopem=Vr,e.pemtohex=qr,e.hextoArrayBuffer=function mn(t){if(t.length%2!=0)throw "input is not even length";if(null==t.match(/^[0-9A-Fa-f]+$/))throw "input is not hexadecimal";for(var e=new ArrayBuffer(t.length/2),r=new DataView(e),n=0;n<t.length/2;n++)r.setUint8(n,parseInt(t.substr(2*n,2),16));return e},e.ArrayBuffertohex=function _n(t){for(var e="",r=new DataView(t),n=0;n<t.byteLength;n++)e+=("00"+r.getUint8(n).toString(16)).slice(-2);return e},e.zulutomsec=Jr,e.zulutosec=Wr,e.zulutodate=function Sn(t){return new Date(Jr(t))},e.datetozulu=function Fn(t,e,r){var n,i=t.getUTCFullYear();if(e){if(i<1950||2049<i)throw "not proper year for UTCTime: "+i;n=(""+i).slice(-2);}else n=("000"+i).slice(-4);if(n+=("0"+(t.getUTCMonth()+1)).slice(-2),n+=("0"+t.getUTCDate()).slice(-2),n+=("0"+t.getUTCHours()).slice(-2),n+=("0"+t.getUTCMinutes()).slice(-2),n+=("0"+t.getUTCSeconds()).slice(-2),r){var o=t.getUTCMilliseconds();0!==o&&(n+="."+(o=(o=("00"+o).slice(-3)).replace(/0+$/g,"")));}return n+="Z"},e.uricmptohex=zr,e.hextouricmp=Yr,e.ipv6tohex=Gr,e.hextoipv6=Xr,e.hextoip=Qr,e.iptohex=function bn(t){var e="malformed IP address";if(!(t=t.toLowerCase(t)).match(/^[0-9.]+$/)){if(t.match(/^[0-9a-f:]+$/)&&-1!==t.indexOf(":"))return Gr(t);throw e}var r=t.split(".");if(4!==r.length)throw e;var n="";try{for(var i=0;i<4;i++)n+=("0"+parseInt(r[i]).toString(16)).slice(-2);return n}catch(t){throw e}},e.encodeURIComponentAll=$r,e.newline_toUnix=function wn(t){return t=t.replace(/\r\n/gm,"\n")},e.newline_toDos=function En(t){return t=(t=t.replace(/\r\n/gm,"\n")).replace(/\n/gm,"\r\n")},e.hextoposhex=Zr,e.intarystrtohex=function xn(t){t=(t=(t=t.replace(/^\s*\[\s*/,"")).replace(/\s*\]\s*$/,"")).replace(/\s*/g,"");try{return t.split(/,/).map(function(t,e,r){var n=parseInt(t);if(n<0||255<n)throw "integer not in range 0-255";return ("00"+n.toString(16)).slice(-2)}).join("")}catch(t){throw "malformed integer array string: "+t}},e.strdiffidx=function t(e,r){var n=e.length;e.length>r.length&&(n=r.length);for(var i=0;i<n;i++)if(e.charCodeAt(i)!=r.charCodeAt(i))return i;return e.length!=r.length?n:-1},e.KJUR=Er;var kn=Er.crypto;e.crypto=kn;var An=Er.asn1;e.asn1=An;var Pn=Er.jws;e.jws=Pn;var Cn=Er.lang;e.lang=Cn;}).call(this,r(27).Buffer);},function(t,e,r){(function(t){
    /*!
     * The buffer module from node.js, for the browser.
     *
     * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
     * @license  MIT
     */
    var n=r(29),i=r(30),o=r(31);function s(){return u.TYPED_ARRAY_SUPPORT?2147483647:1073741823}function a(t,e){if(s()<e)throw new RangeError("Invalid typed array length");return u.TYPED_ARRAY_SUPPORT?(t=new Uint8Array(e)).__proto__=u.prototype:(null===t&&(t=new u(e)),t.length=e),t}function u(t,e,r){if(!(u.TYPED_ARRAY_SUPPORT||this instanceof u))return new u(t,e,r);if("number"==typeof t){if("string"==typeof e)throw new Error("If encoding is specified then the first argument must be a string");return l(this,t)}return c(this,t,e,r)}function c(t,e,r,n){if("number"==typeof e)throw new TypeError('"value" argument must not be a number');return "undefined"!=typeof ArrayBuffer&&e instanceof ArrayBuffer?function i(t,e,r,n){if(e.byteLength,r<0||e.byteLength<r)throw new RangeError("'offset' is out of bounds");if(e.byteLength<r+(n||0))throw new RangeError("'length' is out of bounds");e=void 0===r&&void 0===n?new Uint8Array(e):void 0===n?new Uint8Array(e,r):new Uint8Array(e,r,n);u.TYPED_ARRAY_SUPPORT?(t=e).__proto__=u.prototype:t=f(t,e);return t}(t,e,r,n):"string"==typeof e?function s(t,e,r){"string"==typeof r&&""!==r||(r="utf8");if(!u.isEncoding(r))throw new TypeError('"encoding" must be a valid string encoding');var n=0|p(e,r),i=(t=a(t,n)).write(e,r);i!==n&&(t=t.slice(0,i));return t}(t,e,r):function c(t,e){if(u.isBuffer(e)){var r=0|d(e.length);return 0===(t=a(t,r)).length?t:(e.copy(t,0,0,r),t)}if(e){if("undefined"!=typeof ArrayBuffer&&e.buffer instanceof ArrayBuffer||"length"in e)return "number"!=typeof e.length||function n(t){return t!=t}(e.length)?a(t,0):f(t,e);if("Buffer"===e.type&&o(e.data))return f(t,e.data)}throw new TypeError("First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.")}(t,e)}function h(t){if("number"!=typeof t)throw new TypeError('"size" argument must be a number');if(t<0)throw new RangeError('"size" argument must not be negative')}function l(t,e){if(h(e),t=a(t,e<0?0:0|d(e)),!u.TYPED_ARRAY_SUPPORT)for(var r=0;r<e;++r)t[r]=0;return t}function f(t,e){var r=e.length<0?0:0|d(e.length);t=a(t,r);for(var n=0;n<r;n+=1)t[n]=255&e[n];return t}function d(t){if(t>=s())throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x"+s().toString(16)+" bytes");return 0|t}function p(t,e){if(u.isBuffer(t))return t.length;if("undefined"!=typeof ArrayBuffer&&"function"==typeof ArrayBuffer.isView&&(ArrayBuffer.isView(t)||t instanceof ArrayBuffer))return t.byteLength;"string"!=typeof t&&(t=""+t);var r=t.length;if(0===r)return 0;for(var n=!1;;)switch(e){case"ascii":case"latin1":case"binary":return r;case"utf8":case"utf-8":case void 0:return K(t).length;case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return 2*r;case"hex":return r>>>1;case"base64":return V(t).length;default:if(n)return K(t).length;e=(""+e).toLowerCase(),n=!0;}}function g(t,e,r){var n=t[e];t[e]=t[r],t[r]=n;}function v(t,e,r,n,i){if(0===t.length)return -1;if("string"==typeof r?(n=r,r=0):r>2147483647?r=2147483647:r<-2147483648&&(r=-2147483648),r=+r,isNaN(r)&&(r=i?0:t.length-1),r<0&&(r=t.length+r),r>=t.length){if(i)return -1;r=t.length-1;}else if(r<0){if(!i)return -1;r=0;}if("string"==typeof e&&(e=u.from(e,n)),u.isBuffer(e))return 0===e.length?-1:y(t,e,r,n,i);if("number"==typeof e)return e&=255,u.TYPED_ARRAY_SUPPORT&&"function"==typeof Uint8Array.prototype.indexOf?i?Uint8Array.prototype.indexOf.call(t,e,r):Uint8Array.prototype.lastIndexOf.call(t,e,r):y(t,[e],r,n,i);throw new TypeError("val must be string, number or Buffer")}function y(t,e,r,n,i){var o,s=1,a=t.length,u=e.length;if(void 0!==n&&("ucs2"===(n=String(n).toLowerCase())||"ucs-2"===n||"utf16le"===n||"utf-16le"===n)){if(t.length<2||e.length<2)return -1;s=2,a/=2,u/=2,r/=2;}function c(t,e){return 1===s?t[e]:t.readUInt16BE(e*s)}if(i){var h=-1;for(o=r;o<a;o++)if(c(t,o)===c(e,-1===h?0:o-h)){if(-1===h&&(h=o),o-h+1===u)return h*s}else-1!==h&&(o-=o-h),h=-1;}else for(r+u>a&&(r=a-u),o=r;o>=0;o--){for(var l=!0,f=0;f<u;f++)if(c(t,o+f)!==c(e,f)){l=!1;break}if(l)return o}return -1}function m(t,e,r,n){r=Number(r)||0;var i=t.length-r;n?(n=Number(n))>i&&(n=i):n=i;var o=e.length;if(o%2!=0)throw new TypeError("Invalid hex string");n>o/2&&(n=o/2);for(var s=0;s<n;++s){var a=parseInt(e.substr(2*s,2),16);if(isNaN(a))return s;t[r+s]=a;}return s}function _(t,e,r,n){return q(K(e,t.length-r),t,r,n)}function S(t,e,r,n){return q(function i(t){for(var e=[],r=0;r<t.length;++r)e.push(255&t.charCodeAt(r));return e}(e),t,r,n)}function F(t,e,r,n){return S(t,e,r,n)}function b(t,e,r,n){return q(V(e),t,r,n)}function w(t,e,r,n){return q(function i(t,e){for(var r,n,i,o=[],s=0;s<t.length&&!((e-=2)<0);++s)r=t.charCodeAt(s),n=r>>8,i=r%256,o.push(i),o.push(n);return o}(e,t.length-r),t,r,n)}function E(t,e,r){return 0===e&&r===t.length?n.fromByteArray(t):n.fromByteArray(t.slice(e,r))}function x(t,e,r){r=Math.min(t.length,r);for(var n=[],i=e;i<r;){var o,s,a,u,c=t[i],h=null,l=c>239?4:c>223?3:c>191?2:1;if(i+l<=r)switch(l){case 1:c<128&&(h=c);break;case 2:128==(192&(o=t[i+1]))&&(u=(31&c)<<6|63&o)>127&&(h=u);break;case 3:o=t[i+1],s=t[i+2],128==(192&o)&&128==(192&s)&&(u=(15&c)<<12|(63&o)<<6|63&s)>2047&&(u<55296||u>57343)&&(h=u);break;case 4:o=t[i+1],s=t[i+2],a=t[i+3],128==(192&o)&&128==(192&s)&&128==(192&a)&&(u=(15&c)<<18|(63&o)<<12|(63&s)<<6|63&a)>65535&&u<1114112&&(h=u);}null===h?(h=65533,l=1):h>65535&&(h-=65536,n.push(h>>>10&1023|55296),h=56320|1023&h),n.push(h),i+=l;}return function f(t){var e=t.length;if(e<=P)return String.fromCharCode.apply(String,t);var r="",n=0;for(;n<e;)r+=String.fromCharCode.apply(String,t.slice(n,n+=P));return r}(n)}e.Buffer=u,e.SlowBuffer=function k(t){+t!=t&&(t=0);return u.alloc(+t)},e.INSPECT_MAX_BYTES=50,u.TYPED_ARRAY_SUPPORT=void 0!==t.TYPED_ARRAY_SUPPORT?t.TYPED_ARRAY_SUPPORT:function A(){try{var t=new Uint8Array(1);return t.__proto__={__proto__:Uint8Array.prototype,foo:function(){return 42}},42===t.foo()&&"function"==typeof t.subarray&&0===t.subarray(1,1).byteLength}catch(t){return !1}}(),e.kMaxLength=s(),u.poolSize=8192,u._augment=function(t){return t.__proto__=u.prototype,t},u.from=function(t,e,r){return c(null,t,e,r)},u.TYPED_ARRAY_SUPPORT&&(u.prototype.__proto__=Uint8Array.prototype,u.__proto__=Uint8Array,"undefined"!=typeof Symbol&&Symbol.species&&u[Symbol.species]===u&&Object.defineProperty(u,Symbol.species,{value:null,configurable:!0})),u.alloc=function(t,e,r){return function n(t,e,r,i){return h(e),e<=0?a(t,e):void 0!==r?"string"==typeof i?a(t,e).fill(r,i):a(t,e).fill(r):a(t,e)}(null,t,e,r)},u.allocUnsafe=function(t){return l(null,t)},u.allocUnsafeSlow=function(t){return l(null,t)},u.isBuffer=function t(e){return !(null==e||!e._isBuffer)},u.compare=function t(e,r){if(!u.isBuffer(e)||!u.isBuffer(r))throw new TypeError("Arguments must be Buffers");if(e===r)return 0;for(var n=e.length,i=r.length,o=0,s=Math.min(n,i);o<s;++o)if(e[o]!==r[o]){n=e[o],i=r[o];break}return n<i?-1:i<n?1:0},u.isEncoding=function t(e){switch(String(e).toLowerCase()){case"hex":case"utf8":case"utf-8":case"ascii":case"latin1":case"binary":case"base64":case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return !0;default:return !1}},u.concat=function t(e,r){if(!o(e))throw new TypeError('"list" argument must be an Array of Buffers');if(0===e.length)return u.alloc(0);var n;if(void 0===r)for(r=0,n=0;n<e.length;++n)r+=e[n].length;var i=u.allocUnsafe(r),s=0;for(n=0;n<e.length;++n){var a=e[n];if(!u.isBuffer(a))throw new TypeError('"list" argument must be an Array of Buffers');a.copy(i,s),s+=a.length;}return i},u.byteLength=p,u.prototype._isBuffer=!0,u.prototype.swap16=function t(){var e=this.length;if(e%2!=0)throw new RangeError("Buffer size must be a multiple of 16-bits");for(var r=0;r<e;r+=2)g(this,r,r+1);return this},u.prototype.swap32=function t(){var e=this.length;if(e%4!=0)throw new RangeError("Buffer size must be a multiple of 32-bits");for(var r=0;r<e;r+=4)g(this,r,r+3),g(this,r+1,r+2);return this},u.prototype.swap64=function t(){var e=this.length;if(e%8!=0)throw new RangeError("Buffer size must be a multiple of 64-bits");for(var r=0;r<e;r+=8)g(this,r,r+7),g(this,r+1,r+6),g(this,r+2,r+5),g(this,r+3,r+4);return this},u.prototype.toString=function t(){var e=0|this.length;return 0===e?"":0===arguments.length?x(this,0,e):function r(t,e,n){var i=!1;if((void 0===e||e<0)&&(e=0),e>this.length)return "";if((void 0===n||n>this.length)&&(n=this.length),n<=0)return "";if((n>>>=0)<=(e>>>=0))return "";for(t||(t="utf8");;)switch(t){case"hex":return R(this,e,n);case"utf8":case"utf-8":return x(this,e,n);case"ascii":return C(this,e,n);case"latin1":case"binary":return T(this,e,n);case"base64":return E(this,e,n);case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return I(this,e,n);default:if(i)throw new TypeError("Unknown encoding: "+t);t=(t+"").toLowerCase(),i=!0;}}.apply(this,arguments)},u.prototype.equals=function t(e){if(!u.isBuffer(e))throw new TypeError("Argument must be a Buffer");return this===e||0===u.compare(this,e)},u.prototype.inspect=function t(){var r="",n=e.INSPECT_MAX_BYTES;return this.length>0&&(r=this.toString("hex",0,n).match(/.{2}/g).join(" "),this.length>n&&(r+=" ... ")),"<Buffer "+r+">"},u.prototype.compare=function t(e,r,n,i,o){if(!u.isBuffer(e))throw new TypeError("Argument must be a Buffer");if(void 0===r&&(r=0),void 0===n&&(n=e?e.length:0),void 0===i&&(i=0),void 0===o&&(o=this.length),r<0||n>e.length||i<0||o>this.length)throw new RangeError("out of range index");if(i>=o&&r>=n)return 0;if(i>=o)return -1;if(r>=n)return 1;if(r>>>=0,n>>>=0,i>>>=0,o>>>=0,this===e)return 0;for(var s=o-i,a=n-r,c=Math.min(s,a),h=this.slice(i,o),l=e.slice(r,n),f=0;f<c;++f)if(h[f]!==l[f]){s=h[f],a=l[f];break}return s<a?-1:a<s?1:0},u.prototype.includes=function t(e,r,n){return -1!==this.indexOf(e,r,n)},u.prototype.indexOf=function t(e,r,n){return v(this,e,r,n,!0)},u.prototype.lastIndexOf=function t(e,r,n){return v(this,e,r,n,!1)},u.prototype.write=function t(e,r,n,i){if(void 0===r)i="utf8",n=this.length,r=0;else if(void 0===n&&"string"==typeof r)i=r,n=this.length,r=0;else{if(!isFinite(r))throw new Error("Buffer.write(string, encoding, offset[, length]) is no longer supported");r|=0,isFinite(n)?(n|=0,void 0===i&&(i="utf8")):(i=n,n=void 0);}var o=this.length-r;if((void 0===n||n>o)&&(n=o),e.length>0&&(n<0||r<0)||r>this.length)throw new RangeError("Attempt to write outside buffer bounds");i||(i="utf8");for(var s=!1;;)switch(i){case"hex":return m(this,e,r,n);case"utf8":case"utf-8":return _(this,e,r,n);case"ascii":return S(this,e,r,n);case"latin1":case"binary":return F(this,e,r,n);case"base64":return b(this,e,r,n);case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return w(this,e,r,n);default:if(s)throw new TypeError("Unknown encoding: "+i);i=(""+i).toLowerCase(),s=!0;}},u.prototype.toJSON=function t(){return {type:"Buffer",data:Array.prototype.slice.call(this._arr||this,0)}};var P=4096;function C(t,e,r){var n="";r=Math.min(t.length,r);for(var i=e;i<r;++i)n+=String.fromCharCode(127&t[i]);return n}function T(t,e,r){var n="";r=Math.min(t.length,r);for(var i=e;i<r;++i)n+=String.fromCharCode(t[i]);return n}function R(t,e,r){var n=t.length;(!e||e<0)&&(e=0),(!r||r<0||r>n)&&(r=n);for(var i="",o=e;o<r;++o)i+=M(t[o]);return i}function I(t,e,r){for(var n=t.slice(e,r),i="",o=0;o<n.length;o+=2)i+=String.fromCharCode(n[o]+256*n[o+1]);return i}function D(t,e,r){if(t%1!=0||t<0)throw new RangeError("offset is not uint");if(t+e>r)throw new RangeError("Trying to access beyond buffer length")}function L(t,e,r,n,i,o){if(!u.isBuffer(t))throw new TypeError('"buffer" argument must be a Buffer instance');if(e>i||e<o)throw new RangeError('"value" argument is out of bounds');if(r+n>t.length)throw new RangeError("Index out of range")}function U(t,e,r,n){e<0&&(e=65535+e+1);for(var i=0,o=Math.min(t.length-r,2);i<o;++i)t[r+i]=(e&255<<8*(n?i:1-i))>>>8*(n?i:1-i);}function B(t,e,r,n){e<0&&(e=4294967295+e+1);for(var i=0,o=Math.min(t.length-r,4);i<o;++i)t[r+i]=e>>>8*(n?i:3-i)&255;}function N(t,e,r,n,i,o){if(r+n>t.length)throw new RangeError("Index out of range");if(r<0)throw new RangeError("Index out of range")}function O(t,e,r,n,o){return o||N(t,0,r,4),i.write(t,e,r,n,23,4),r+4}function j(t,e,r,n,o){return o||N(t,0,r,8),i.write(t,e,r,n,52,8),r+8}u.prototype.slice=function t(e,r){var n,i=this.length;if(e=~~e,r=void 0===r?i:~~r,e<0?(e+=i)<0&&(e=0):e>i&&(e=i),r<0?(r+=i)<0&&(r=0):r>i&&(r=i),r<e&&(r=e),u.TYPED_ARRAY_SUPPORT)(n=this.subarray(e,r)).__proto__=u.prototype;else{var o=r-e;n=new u(o,void 0);for(var s=0;s<o;++s)n[s]=this[s+e];}return n},u.prototype.readUIntLE=function t(e,r,n){e|=0,r|=0,n||D(e,r,this.length);for(var i=this[e],o=1,s=0;++s<r&&(o*=256);)i+=this[e+s]*o;return i},u.prototype.readUIntBE=function t(e,r,n){e|=0,r|=0,n||D(e,r,this.length);for(var i=this[e+--r],o=1;r>0&&(o*=256);)i+=this[e+--r]*o;return i},u.prototype.readUInt8=function t(e,r){return r||D(e,1,this.length),this[e]},u.prototype.readUInt16LE=function t(e,r){return r||D(e,2,this.length),this[e]|this[e+1]<<8},u.prototype.readUInt16BE=function t(e,r){return r||D(e,2,this.length),this[e]<<8|this[e+1]},u.prototype.readUInt32LE=function t(e,r){return r||D(e,4,this.length),(this[e]|this[e+1]<<8|this[e+2]<<16)+16777216*this[e+3]},u.prototype.readUInt32BE=function t(e,r){return r||D(e,4,this.length),16777216*this[e]+(this[e+1]<<16|this[e+2]<<8|this[e+3])},u.prototype.readIntLE=function t(e,r,n){e|=0,r|=0,n||D(e,r,this.length);for(var i=this[e],o=1,s=0;++s<r&&(o*=256);)i+=this[e+s]*o;return i>=(o*=128)&&(i-=Math.pow(2,8*r)),i},u.prototype.readIntBE=function t(e,r,n){e|=0,r|=0,n||D(e,r,this.length);for(var i=r,o=1,s=this[e+--i];i>0&&(o*=256);)s+=this[e+--i]*o;return s>=(o*=128)&&(s-=Math.pow(2,8*r)),s},u.prototype.readInt8=function t(e,r){return r||D(e,1,this.length),128&this[e]?-1*(255-this[e]+1):this[e]},u.prototype.readInt16LE=function t(e,r){r||D(e,2,this.length);var n=this[e]|this[e+1]<<8;return 32768&n?4294901760|n:n},u.prototype.readInt16BE=function t(e,r){r||D(e,2,this.length);var n=this[e+1]|this[e]<<8;return 32768&n?4294901760|n:n},u.prototype.readInt32LE=function t(e,r){return r||D(e,4,this.length),this[e]|this[e+1]<<8|this[e+2]<<16|this[e+3]<<24},u.prototype.readInt32BE=function t(e,r){return r||D(e,4,this.length),this[e]<<24|this[e+1]<<16|this[e+2]<<8|this[e+3]},u.prototype.readFloatLE=function t(e,r){return r||D(e,4,this.length),i.read(this,e,!0,23,4)},u.prototype.readFloatBE=function t(e,r){return r||D(e,4,this.length),i.read(this,e,!1,23,4)},u.prototype.readDoubleLE=function t(e,r){return r||D(e,8,this.length),i.read(this,e,!0,52,8)},u.prototype.readDoubleBE=function t(e,r){return r||D(e,8,this.length),i.read(this,e,!1,52,8)},u.prototype.writeUIntLE=function t(e,r,n,i){(e=+e,r|=0,n|=0,i)||L(this,e,r,n,Math.pow(2,8*n)-1,0);var o=1,s=0;for(this[r]=255&e;++s<n&&(o*=256);)this[r+s]=e/o&255;return r+n},u.prototype.writeUIntBE=function t(e,r,n,i){(e=+e,r|=0,n|=0,i)||L(this,e,r,n,Math.pow(2,8*n)-1,0);var o=n-1,s=1;for(this[r+o]=255&e;--o>=0&&(s*=256);)this[r+o]=e/s&255;return r+n},u.prototype.writeUInt8=function t(e,r,n){return e=+e,r|=0,n||L(this,e,r,1,255,0),u.TYPED_ARRAY_SUPPORT||(e=Math.floor(e)),this[r]=255&e,r+1},u.prototype.writeUInt16LE=function t(e,r,n){return e=+e,r|=0,n||L(this,e,r,2,65535,0),u.TYPED_ARRAY_SUPPORT?(this[r]=255&e,this[r+1]=e>>>8):U(this,e,r,!0),r+2},u.prototype.writeUInt16BE=function t(e,r,n){return e=+e,r|=0,n||L(this,e,r,2,65535,0),u.TYPED_ARRAY_SUPPORT?(this[r]=e>>>8,this[r+1]=255&e):U(this,e,r,!1),r+2},u.prototype.writeUInt32LE=function t(e,r,n){return e=+e,r|=0,n||L(this,e,r,4,4294967295,0),u.TYPED_ARRAY_SUPPORT?(this[r+3]=e>>>24,this[r+2]=e>>>16,this[r+1]=e>>>8,this[r]=255&e):B(this,e,r,!0),r+4},u.prototype.writeUInt32BE=function t(e,r,n){return e=+e,r|=0,n||L(this,e,r,4,4294967295,0),u.TYPED_ARRAY_SUPPORT?(this[r]=e>>>24,this[r+1]=e>>>16,this[r+2]=e>>>8,this[r+3]=255&e):B(this,e,r,!1),r+4},u.prototype.writeIntLE=function t(e,r,n,i){if(e=+e,r|=0,!i){var o=Math.pow(2,8*n-1);L(this,e,r,n,o-1,-o);}var s=0,a=1,u=0;for(this[r]=255&e;++s<n&&(a*=256);)e<0&&0===u&&0!==this[r+s-1]&&(u=1),this[r+s]=(e/a>>0)-u&255;return r+n},u.prototype.writeIntBE=function t(e,r,n,i){if(e=+e,r|=0,!i){var o=Math.pow(2,8*n-1);L(this,e,r,n,o-1,-o);}var s=n-1,a=1,u=0;for(this[r+s]=255&e;--s>=0&&(a*=256);)e<0&&0===u&&0!==this[r+s+1]&&(u=1),this[r+s]=(e/a>>0)-u&255;return r+n},u.prototype.writeInt8=function t(e,r,n){return e=+e,r|=0,n||L(this,e,r,1,127,-128),u.TYPED_ARRAY_SUPPORT||(e=Math.floor(e)),e<0&&(e=255+e+1),this[r]=255&e,r+1},u.prototype.writeInt16LE=function t(e,r,n){return e=+e,r|=0,n||L(this,e,r,2,32767,-32768),u.TYPED_ARRAY_SUPPORT?(this[r]=255&e,this[r+1]=e>>>8):U(this,e,r,!0),r+2},u.prototype.writeInt16BE=function t(e,r,n){return e=+e,r|=0,n||L(this,e,r,2,32767,-32768),u.TYPED_ARRAY_SUPPORT?(this[r]=e>>>8,this[r+1]=255&e):U(this,e,r,!1),r+2},u.prototype.writeInt32LE=function t(e,r,n){return e=+e,r|=0,n||L(this,e,r,4,2147483647,-2147483648),u.TYPED_ARRAY_SUPPORT?(this[r]=255&e,this[r+1]=e>>>8,this[r+2]=e>>>16,this[r+3]=e>>>24):B(this,e,r,!0),r+4},u.prototype.writeInt32BE=function t(e,r,n){return e=+e,r|=0,n||L(this,e,r,4,2147483647,-2147483648),e<0&&(e=4294967295+e+1),u.TYPED_ARRAY_SUPPORT?(this[r]=e>>>24,this[r+1]=e>>>16,this[r+2]=e>>>8,this[r+3]=255&e):B(this,e,r,!1),r+4},u.prototype.writeFloatLE=function t(e,r,n){return O(this,e,r,!0,n)},u.prototype.writeFloatBE=function t(e,r,n){return O(this,e,r,!1,n)},u.prototype.writeDoubleLE=function t(e,r,n){return j(this,e,r,!0,n)},u.prototype.writeDoubleBE=function t(e,r,n){return j(this,e,r,!1,n)},u.prototype.copy=function t(e,r,n,i){if(n||(n=0),i||0===i||(i=this.length),r>=e.length&&(r=e.length),r||(r=0),i>0&&i<n&&(i=n),i===n)return 0;if(0===e.length||0===this.length)return 0;if(r<0)throw new RangeError("targetStart out of bounds");if(n<0||n>=this.length)throw new RangeError("sourceStart out of bounds");if(i<0)throw new RangeError("sourceEnd out of bounds");i>this.length&&(i=this.length),e.length-r<i-n&&(i=e.length-r+n);var o,s=i-n;if(this===e&&n<r&&r<i)for(o=s-1;o>=0;--o)e[o+r]=this[o+n];else if(s<1e3||!u.TYPED_ARRAY_SUPPORT)for(o=0;o<s;++o)e[o+r]=this[o+n];else Uint8Array.prototype.set.call(e,this.subarray(n,n+s),r);return s},u.prototype.fill=function t(e,r,n,i){if("string"==typeof e){if("string"==typeof r?(i=r,r=0,n=this.length):"string"==typeof n&&(i=n,n=this.length),1===e.length){var o=e.charCodeAt(0);o<256&&(e=o);}if(void 0!==i&&"string"!=typeof i)throw new TypeError("encoding must be a string");if("string"==typeof i&&!u.isEncoding(i))throw new TypeError("Unknown encoding: "+i)}else"number"==typeof e&&(e&=255);if(r<0||this.length<r||this.length<n)throw new RangeError("Out of range index");if(n<=r)return this;var s;if(r>>>=0,n=void 0===n?this.length:n>>>0,e||(e=0),"number"==typeof e)for(s=r;s<n;++s)this[s]=e;else{var a=u.isBuffer(e)?e:K(new u(e,i).toString()),c=a.length;for(s=0;s<n-r;++s)this[s+r]=a[s%c];}return this};var H=/[^+\/0-9A-Za-z-_]/g;function M(t){return t<16?"0"+t.toString(16):t.toString(16)}function K(t,e){var r;e=e||1/0;for(var n=t.length,i=null,o=[],s=0;s<n;++s){if((r=t.charCodeAt(s))>55295&&r<57344){if(!i){if(r>56319){(e-=3)>-1&&o.push(239,191,189);continue}if(s+1===n){(e-=3)>-1&&o.push(239,191,189);continue}i=r;continue}if(r<56320){(e-=3)>-1&&o.push(239,191,189),i=r;continue}r=65536+(i-55296<<10|r-56320);}else i&&(e-=3)>-1&&o.push(239,191,189);if(i=null,r<128){if((e-=1)<0)break;o.push(r);}else if(r<2048){if((e-=2)<0)break;o.push(r>>6|192,63&r|128);}else if(r<65536){if((e-=3)<0)break;o.push(r>>12|224,r>>6&63|128,63&r|128);}else{if(!(r<1114112))throw new Error("Invalid code point");if((e-=4)<0)break;o.push(r>>18|240,r>>12&63|128,r>>6&63|128,63&r|128);}}return o}function V(t){return n.toByteArray(function e(t){if((t=function e(t){return t.trim?t.trim():t.replace(/^\s+|\s+$/g,"")}(t).replace(H,"")).length<2)return "";for(;t.length%4!=0;)t+="=";return t}(t))}function q(t,e,r,n){for(var i=0;i<n&&!(i+r>=e.length||i>=t.length);++i)e[i+r]=t[i];return i}}).call(this,r(28));},function(t,e){var r;r=function(){return this}();try{r=r||new Function("return this")();}catch(t){"object"==typeof window&&(r=window);}t.exports=r;},function(t,e,r){e.byteLength=function n(t){var e=f(t),r=e[0],n=e[1];return 3*(r+n)/4-n},e.toByteArray=function i(t){for(var e,r=f(t),n=r[0],i=r[1],o=new u(function s(t,e,r){return 3*(e+r)/4-r}(0,n,i)),c=0,h=i>0?n-4:n,l=0;l<h;l+=4)e=a[t.charCodeAt(l)]<<18|a[t.charCodeAt(l+1)]<<12|a[t.charCodeAt(l+2)]<<6|a[t.charCodeAt(l+3)],o[c++]=e>>16&255,o[c++]=e>>8&255,o[c++]=255&e;2===i&&(e=a[t.charCodeAt(l)]<<2|a[t.charCodeAt(l+1)]>>4,o[c++]=255&e);1===i&&(e=a[t.charCodeAt(l)]<<10|a[t.charCodeAt(l+1)]<<4|a[t.charCodeAt(l+2)]>>2,o[c++]=e>>8&255,o[c++]=255&e);return o},e.fromByteArray=function o(t){for(var e,r=t.length,n=r%3,i=[],o=0,a=r-n;o<a;o+=16383)i.push(d(t,o,o+16383>a?a:o+16383));1===n?(e=t[r-1],i.push(s[e>>2]+s[e<<4&63]+"==")):2===n&&(e=(t[r-2]<<8)+t[r-1],i.push(s[e>>10]+s[e>>4&63]+s[e<<2&63]+"="));return i.join("")};for(var s=[],a=[],u="undefined"!=typeof Uint8Array?Uint8Array:Array,c="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",h=0,l=c.length;h<l;++h)s[h]=c[h],a[c.charCodeAt(h)]=h;function f(t){var e=t.length;if(e%4>0)throw new Error("Invalid string. Length must be a multiple of 4");var r=t.indexOf("=");return -1===r&&(r=e),[r,r===e?0:4-r%4]}function d(t,e,r){for(var n,i,o=[],a=e;a<r;a+=3)n=(t[a]<<16&16711680)+(t[a+1]<<8&65280)+(255&t[a+2]),o.push(s[(i=n)>>18&63]+s[i>>12&63]+s[i>>6&63]+s[63&i]);return o.join("")}a["-".charCodeAt(0)]=62,a["_".charCodeAt(0)]=63;},function(t,e){e.read=function(t,e,r,n,i){var o,s,a=8*i-n-1,u=(1<<a)-1,c=u>>1,h=-7,l=r?i-1:0,f=r?-1:1,d=t[e+l];for(l+=f,o=d&(1<<-h)-1,d>>=-h,h+=a;h>0;o=256*o+t[e+l],l+=f,h-=8);for(s=o&(1<<-h)-1,o>>=-h,h+=n;h>0;s=256*s+t[e+l],l+=f,h-=8);if(0===o)o=1-c;else{if(o===u)return s?NaN:1/0*(d?-1:1);s+=Math.pow(2,n),o-=c;}return (d?-1:1)*s*Math.pow(2,o-n)},e.write=function(t,e,r,n,i,o){var s,a,u,c=8*o-i-1,h=(1<<c)-1,l=h>>1,f=23===i?Math.pow(2,-24)-Math.pow(2,-77):0,d=n?0:o-1,p=n?1:-1,g=e<0||0===e&&1/e<0?1:0;for(e=Math.abs(e),isNaN(e)||e===1/0?(a=isNaN(e)?1:0,s=h):(s=Math.floor(Math.log(e)/Math.LN2),e*(u=Math.pow(2,-s))<1&&(s--,u*=2),(e+=s+l>=1?f/u:f*Math.pow(2,1-l))*u>=2&&(s++,u/=2),s+l>=h?(a=0,s=h):s+l>=1?(a=(e*u-1)*Math.pow(2,i),s+=l):(a=e*Math.pow(2,l-1)*Math.pow(2,i),s=0));i>=8;t[r+d]=255&a,d+=p,a/=256,i-=8);for(s=s<<i|a,c+=i;c>0;t[r+d]=255&s,d+=p,s/=256,c-=8);t[r+d-p]|=128*g;};},function(t,e){var r={}.toString;t.exports=Array.isArray||function(t){return "[object Array]"==r.call(t)};},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.default=function n(t){var e=t.jws,r=t.KeyUtil,n=t.X509,o=t.crypto,s=t.hextob64u,a=t.b64tohex,u=t.AllowedSigningAlgs;return function(){function t(){!function e(t,r){if(!(t instanceof r))throw new TypeError("Cannot call a class as a function")}(this,t);}return t.parseJwt=function t(r){i.Log.debug("JoseUtil.parseJwt");try{var n=e.JWS.parse(r);return {header:n.headerObj,payload:n.payloadObj}}catch(t){i.Log.error(t);}},t.validateJwt=function e(o,s,u,c,h,l,f){i.Log.debug("JoseUtil.validateJwt");try{if("RSA"===s.kty)if(s.e&&s.n)s=r.getKey(s);else{if(!s.x5c||!s.x5c.length)return i.Log.error("JoseUtil.validateJwt: RSA key missing key material",s),Promise.reject(new Error("RSA key missing key material"));var d=a(s.x5c[0]);s=n.getPublicKeyFromCertHex(d);}else{if("EC"!==s.kty)return i.Log.error("JoseUtil.validateJwt: Unsupported key type",s&&s.kty),Promise.reject(new Error(s.kty));if(!(s.crv&&s.x&&s.y))return i.Log.error("JoseUtil.validateJwt: EC key missing key material",s),Promise.reject(new Error("EC key missing key material"));s=r.getKey(s);}return t._validateJwt(o,s,u,c,h,l,f)}catch(t){return i.Log.error(t&&t.message||t),Promise.reject("JWT validation failed")}},t.validateJwtAttributes=function e(r,n,o,s,a,u){s||(s=0),a||(a=parseInt(Date.now()/1e3));var c=t.parseJwt(r).payload;if(!c.iss)return i.Log.error("JoseUtil._validateJwt: issuer was not provided"),Promise.reject(new Error("issuer was not provided"));if(c.iss!==n)return i.Log.error("JoseUtil._validateJwt: Invalid issuer in token",c.iss),Promise.reject(new Error("Invalid issuer in token: "+c.iss));if(!c.aud)return i.Log.error("JoseUtil._validateJwt: aud was not provided"),Promise.reject(new Error("aud was not provided"));var h=c.aud===o||Array.isArray(c.aud)&&c.aud.indexOf(o)>=0;if(!h)return i.Log.error("JoseUtil._validateJwt: Invalid audience in token",c.aud),Promise.reject(new Error("Invalid audience in token: "+c.aud));if(c.azp&&c.azp!==o)return i.Log.error("JoseUtil._validateJwt: Invalid azp in token",c.azp),Promise.reject(new Error("Invalid azp in token: "+c.azp));if(!u){var l=a+s,f=a-s;if(!c.iat)return i.Log.error("JoseUtil._validateJwt: iat was not provided"),Promise.reject(new Error("iat was not provided"));if(l<c.iat)return i.Log.error("JoseUtil._validateJwt: iat is in the future",c.iat),Promise.reject(new Error("iat is in the future: "+c.iat));if(c.nbf&&l<c.nbf)return i.Log.error("JoseUtil._validateJwt: nbf is in the future",c.nbf),Promise.reject(new Error("nbf is in the future: "+c.nbf));if(!c.exp)return i.Log.error("JoseUtil._validateJwt: exp was not provided"),Promise.reject(new Error("exp was not provided"));if(c.exp<f)return i.Log.error("JoseUtil._validateJwt: exp is in the past",c.exp),Promise.reject(new Error("exp is in the past:"+c.exp))}return Promise.resolve(c)},t._validateJwt=function r(n,o,s,a,c,h,l){return t.validateJwtAttributes(n,s,a,c,h,l).then(function(t){try{return e.JWS.verify(n,o,u)?t:(i.Log.error("JoseUtil._validateJwt: signature validation failed"),Promise.reject(new Error("signature validation failed")))}catch(t){return i.Log.error(t&&t.message||t),Promise.reject(new Error("signature validation failed"))}})},t.hashString=function t(e,r){try{return o.Util.hashString(e,r)}catch(t){i.Log.error(t);}},t.hexToBase64Url=function t(e){try{return s(e)}catch(t){i.Log.error(t);}},t}()};var i=r(0);t.exports=e.default;},function(t,e,r){var n=r(34),i=r(35);t.exports=function o(t,e,r){var o=e&&r||0;"string"==typeof t&&(e="binary"===t?new Array(16):null,t=null);var s=(t=t||{}).random||(t.rng||n)();if(s[6]=15&s[6]|64,s[8]=63&s[8]|128,e)for(var a=0;a<16;++a)e[o+a]=s[a];return e||i(s)};},function(t,e){var r="undefined"!=typeof crypto&&crypto.getRandomValues&&crypto.getRandomValues.bind(crypto)||"undefined"!=typeof msCrypto&&"function"==typeof window.msCrypto.getRandomValues&&msCrypto.getRandomValues.bind(msCrypto);if(r){var n=new Uint8Array(16);t.exports=function t(){return r(n),n};}else{var i=new Array(16);t.exports=function t(){for(var e,r=0;r<16;r++)0==(3&r)&&(e=4294967296*Math.random()),i[r]=e>>>((3&r)<<3)&255;return i};}},function(t,e){for(var r=[],n=0;n<256;++n)r[n]=(n+256).toString(16).substr(1);t.exports=function i(t,e){var n=e||0,i=r;return [i[t[n++]],i[t[n++]],i[t[n++]],i[t[n++]],"-",i[t[n++]],i[t[n++]],"-",i[t[n++]],i[t[n++]],"-",i[t[n++]],i[t[n++]],"-",i[t[n++]],i[t[n++]],i[t[n++]],i[t[n++]],i[t[n++]],i[t[n++]]].join("")};},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.SigninResponse=void 0;var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),i=r(3);e.SigninResponse=function(){function t(e){var r=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"#";!function n(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t);var o=i.UrlUtility.parseUrlFragment(e,r);this.error=o.error,this.error_description=o.error_description,this.error_uri=o.error_uri,this.code=o.code,this.state=o.state,this.id_token=o.id_token,this.session_state=o.session_state,this.access_token=o.access_token,this.token_type=o.token_type,this.scope=o.scope,this.profile=void 0,this.expires_in=o.expires_in;}return n(t,[{key:"expires_in",get:function t(){if(this.expires_at){var e=parseInt(Date.now()/1e3);return this.expires_at-e}},set:function t(e){var r=parseInt(e);if("number"==typeof r&&r>0){var n=parseInt(Date.now()/1e3);this.expires_at=n+r;}}},{key:"expired",get:function t(){var e=this.expires_in;if(void 0!==e)return e<=0}},{key:"scopes",get:function t(){return (this.scope||"").split(" ")}},{key:"isOpenIdConnect",get:function t(){return this.scopes.indexOf("openid")>=0||!!this.id_token}}]),t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.SignoutRequest=void 0;var n=r(0),i=r(3),o=r(8);e.SignoutRequest=function t(e){var r=e.url,s=e.id_token_hint,a=e.post_logout_redirect_uri,u=e.data,c=e.extraQueryParams,h=e.request_type;if(function l(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),!r)throw n.Log.error("SignoutRequest.ctor: No url passed"),new Error("url");for(var f in s&&(r=i.UrlUtility.addQueryParam(r,"id_token_hint",s)),a&&(r=i.UrlUtility.addQueryParam(r,"post_logout_redirect_uri",a),u&&(this.state=new o.State({data:u,request_type:h}),r=i.UrlUtility.addQueryParam(r,"state",this.state.id))),c)r=i.UrlUtility.addQueryParam(r,f,c[f]);this.url=r;};},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.SignoutResponse=void 0;var n=r(3);e.SignoutResponse=function t(e){!function r(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t);var i=n.UrlUtility.parseUrlFragment(e,"?");this.error=i.error,this.error_description=i.error_description,this.error_uri=i.error_uri,this.state=i.state;};},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.InMemoryWebStorage=void 0;var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),i=r(0);e.InMemoryWebStorage=function(){function t(){!function e(t,r){if(!(t instanceof r))throw new TypeError("Cannot call a class as a function")}(this,t),this._data={};}return t.prototype.getItem=function t(e){return i.Log.debug("InMemoryWebStorage.getItem",e),this._data[e]},t.prototype.setItem=function t(e,r){i.Log.debug("InMemoryWebStorage.setItem",e),this._data[e]=r;},t.prototype.removeItem=function t(e){i.Log.debug("InMemoryWebStorage.removeItem",e),delete this._data[e];},t.prototype.key=function t(e){return Object.getOwnPropertyNames(this._data)[e]},n(t,[{key:"length",get:function t(){return Object.getOwnPropertyNames(this._data).length}}]),t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.UserManager=void 0;var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),i=r(0),o=r(9),s=r(41),a=r(15),u=r(47),c=r(49),h=r(18),l=r(20),f=r(10),d=r(4);e.UserManager=function(t){function e(){var r=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},n=arguments.length>1&&void 0!==arguments[1]?arguments[1]:c.SilentRenewService,o=arguments.length>2&&void 0!==arguments[2]?arguments[2]:h.SessionMonitor,a=arguments.length>3&&void 0!==arguments[3]?arguments[3]:l.TokenRevocationClient,p=arguments.length>4&&void 0!==arguments[4]?arguments[4]:f.TokenClient,g=arguments.length>5&&void 0!==arguments[5]?arguments[5]:d.JoseUtil;!function v(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,e),r instanceof s.UserManagerSettings||(r=new s.UserManagerSettings(r));var y=function m(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return !e||"object"!=typeof e&&"function"!=typeof e?t:e}(this,t.call(this,r));return y._events=new u.UserManagerEvents(r),y._silentRenewService=new n(y),y.settings.automaticSilentRenew&&(i.Log.debug("UserManager.ctor: automaticSilentRenew is configured, setting up silent renew"),y.startSilentRenew()),y.settings.monitorSession&&(i.Log.debug("UserManager.ctor: monitorSession is configured, setting up session monitor"),y._sessionMonitor=new o(y)),y._tokenRevocationClient=new a(y._settings),y._tokenClient=new p(y._settings),y._joseUtil=g,y}return function r(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e);}(e,t),e.prototype.getUser=function t(){var e=this;return this._loadUser().then(function(t){return t?(i.Log.info("UserManager.getUser: user loaded"),e._events.load(t,!1),t):(i.Log.info("UserManager.getUser: user not found in storage"),null)})},e.prototype.removeUser=function t(){var e=this;return this.storeUser(null).then(function(){i.Log.info("UserManager.removeUser: user removed from storage"),e._events.unload();})},e.prototype.signinRedirect=function t(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};(e=Object.assign({},e)).request_type="si:r";var r={useReplaceToNavigate:e.useReplaceToNavigate};return this._signinStart(e,this._redirectNavigator,r).then(function(){i.Log.info("UserManager.signinRedirect: successful");})},e.prototype.signinRedirectCallback=function t(e){return this._signinEnd(e||this._redirectNavigator.url).then(function(t){return t.profile&&t.profile.sub?i.Log.info("UserManager.signinRedirectCallback: successful, signed in sub: ",t.profile.sub):i.Log.info("UserManager.signinRedirectCallback: no sub"),t})},e.prototype.signinPopup=function t(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};(e=Object.assign({},e)).request_type="si:p";var r=e.redirect_uri||this.settings.popup_redirect_uri||this.settings.redirect_uri;return r?(e.redirect_uri=r,e.display="popup",this._signin(e,this._popupNavigator,{startUrl:r,popupWindowFeatures:e.popupWindowFeatures||this.settings.popupWindowFeatures,popupWindowTarget:e.popupWindowTarget||this.settings.popupWindowTarget}).then(function(t){return t&&(t.profile&&t.profile.sub?i.Log.info("UserManager.signinPopup: signinPopup successful, signed in sub: ",t.profile.sub):i.Log.info("UserManager.signinPopup: no sub")),t})):(i.Log.error("UserManager.signinPopup: No popup_redirect_uri or redirect_uri configured"),Promise.reject(new Error("No popup_redirect_uri or redirect_uri configured")))},e.prototype.signinPopupCallback=function t(e){return this._signinCallback(e,this._popupNavigator).then(function(t){return t&&(t.profile&&t.profile.sub?i.Log.info("UserManager.signinPopupCallback: successful, signed in sub: ",t.profile.sub):i.Log.info("UserManager.signinPopupCallback: no sub")),t}).catch(function(t){i.Log.error(t.message);})},e.prototype.signinSilent=function t(){var e=this,r=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};return (r=Object.assign({},r)).request_type="si:s",this._loadUser().then(function(t){return t&&t.refresh_token?(r.refresh_token=t.refresh_token,e._useRefreshToken(r)):(r.id_token_hint=r.id_token_hint||e.settings.includeIdTokenInSilentRenew&&t&&t.id_token,t&&e._settings.validateSubOnSilentRenew&&(i.Log.debug("UserManager.signinSilent, subject prior to silent renew: ",t.profile.sub),r.current_sub=t.profile.sub),e._signinSilentIframe(r))})},e.prototype._useRefreshToken=function t(){var e=this,r=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};return this._tokenClient.exchangeRefreshToken(r).then(function(t){return t?t.access_token?e._loadUser().then(function(r){if(r){var n=Promise.resolve();return t.id_token&&(n=e._validateIdTokenFromTokenRefreshToken(r.profile,t.id_token)),n.then(function(){return i.Log.debug("UserManager._useRefreshToken: refresh token response success"),r.id_token=t.id_token,r.access_token=t.access_token,r.refresh_token=t.refresh_token||r.refresh_token,r.expires_in=t.expires_in,e.storeUser(r).then(function(){return e._events.load(r),r})})}return null}):(i.Log.error("UserManager._useRefreshToken: No access token returned from token endpoint"),Promise.reject("No access token returned from token endpoint")):(i.Log.error("UserManager._useRefreshToken: No response returned from token endpoint"),Promise.reject("No response returned from token endpoint"))})},e.prototype._validateIdTokenFromTokenRefreshToken=function t(e,r){var n=this;return this._metadataService.getIssuer().then(function(t){return n._joseUtil.validateJwtAttributes(r,t,n._settings.client_id,n._settings.clockSkew).then(function(t){return t?t.sub!==e.sub?(i.Log.error("UserManager._validateIdTokenFromTokenRefreshToken: sub in id_token does not match current sub"),Promise.reject(new Error("sub in id_token does not match current sub"))):t.auth_time&&t.auth_time!==e.auth_time?(i.Log.error("UserManager._validateIdTokenFromTokenRefreshToken: auth_time in id_token does not match original auth_time"),Promise.reject(new Error("auth_time in id_token does not match original auth_time"))):t.azp&&t.azp!==e.azp?(i.Log.error("UserManager._validateIdTokenFromTokenRefreshToken: azp in id_token does not match original azp"),Promise.reject(new Error("azp in id_token does not match original azp"))):!t.azp&&e.azp?(i.Log.error("UserManager._validateIdTokenFromTokenRefreshToken: azp not in id_token, but present in original id_token"),Promise.reject(new Error("azp not in id_token, but present in original id_token"))):void 0:(i.Log.error("UserManager._validateIdTokenFromTokenRefreshToken: Failed to validate id_token"),Promise.reject(new Error("Failed to validate id_token")))})})},e.prototype._signinSilentIframe=function t(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},r=e.redirect_uri||this.settings.silent_redirect_uri||this.settings.redirect_uri;return r?(e.redirect_uri=r,e.prompt=e.prompt||"none",this._signin(e,this._iframeNavigator,{startUrl:r,silentRequestTimeout:e.silentRequestTimeout||this.settings.silentRequestTimeout}).then(function(t){return t&&(t.profile&&t.profile.sub?i.Log.info("UserManager.signinSilent: successful, signed in sub: ",t.profile.sub):i.Log.info("UserManager.signinSilent: no sub")),t})):(i.Log.error("UserManager.signinSilent: No silent_redirect_uri configured"),Promise.reject(new Error("No silent_redirect_uri configured")))},e.prototype.signinSilentCallback=function t(e){return this._signinCallback(e,this._iframeNavigator).then(function(t){return t&&(t.profile&&t.profile.sub?i.Log.info("UserManager.signinSilentCallback: successful, signed in sub: ",t.profile.sub):i.Log.info("UserManager.signinSilentCallback: no sub")),t})},e.prototype.signinCallback=function t(e){var r=this;return this.readSigninResponseState(e).then(function(t){var n=t.state;t.response;return "si:r"===n.request_type?r.signinRedirectCallback(e):"si:p"===n.request_type?r.signinPopupCallback(e):"si:s"===n.request_type?r.signinSilentCallback(e):Promise.reject(new Error("invalid response_type in state"))})},e.prototype.signoutCallback=function t(e,r){var n=this;return this.readSignoutResponseState(e).then(function(t){var i=t.state,o=t.response;return i?"so:r"===i.request_type?n.signoutRedirectCallback(e):"so:p"===i.request_type?n.signoutPopupCallback(e,r):Promise.reject(new Error("invalid response_type in state")):o})},e.prototype.querySessionStatus=function t(){var e=this,r=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};(r=Object.assign({},r)).request_type="si:s";var n=r.redirect_uri||this.settings.silent_redirect_uri||this.settings.redirect_uri;return n?(r.redirect_uri=n,r.prompt="none",r.response_type=r.response_type||this.settings.query_status_response_type,r.scope=r.scope||"openid",r.skipUserInfo=!0,this._signinStart(r,this._iframeNavigator,{startUrl:n,silentRequestTimeout:r.silentRequestTimeout||this.settings.silentRequestTimeout}).then(function(t){return e.processSigninResponse(t.url).then(function(t){if(i.Log.debug("UserManager.querySessionStatus: got signin response"),t.session_state&&t.profile.sub)return i.Log.info("UserManager.querySessionStatus: querySessionStatus success for sub: ",t.profile.sub),{session_state:t.session_state,sub:t.profile.sub,sid:t.profile.sid};i.Log.info("querySessionStatus successful, user not authenticated");})})):(i.Log.error("UserManager.querySessionStatus: No silent_redirect_uri configured"),Promise.reject(new Error("No silent_redirect_uri configured")))},e.prototype._signin=function t(e,r){var n=this,i=arguments.length>2&&void 0!==arguments[2]?arguments[2]:{};return this._signinStart(e,r,i).then(function(t){return n._signinEnd(t.url,e)})},e.prototype._signinStart=function t(e,r){var n=this,o=arguments.length>2&&void 0!==arguments[2]?arguments[2]:{};return r.prepare(o).then(function(t){return i.Log.debug("UserManager._signinStart: got navigator window handle"),n.createSigninRequest(e).then(function(e){return i.Log.debug("UserManager._signinStart: got signin request"),o.url=e.url,o.id=e.state.id,t.navigate(o)}).catch(function(e){throw t.close&&(i.Log.debug("UserManager._signinStart: Error after preparing navigator, closing navigator window"),t.close()),e})})},e.prototype._signinEnd=function t(e){var r=this,n=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};return this.processSigninResponse(e).then(function(t){i.Log.debug("UserManager._signinEnd: got signin response");var e=new a.User(t);if(n.current_sub){if(n.current_sub!==e.profile.sub)return i.Log.debug("UserManager._signinEnd: current user does not match user returned from signin. sub from signin: ",e.profile.sub),Promise.reject(new Error("login_required"));i.Log.debug("UserManager._signinEnd: current user matches user returned from signin");}return r.storeUser(e).then(function(){return i.Log.debug("UserManager._signinEnd: user stored"),r._events.load(e),e})})},e.prototype._signinCallback=function t(e,r){return i.Log.debug("UserManager._signinCallback"),r.callback(e)},e.prototype.signoutRedirect=function t(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};(e=Object.assign({},e)).request_type="so:r";var r=e.post_logout_redirect_uri||this.settings.post_logout_redirect_uri;r&&(e.post_logout_redirect_uri=r);var n={useReplaceToNavigate:e.useReplaceToNavigate};return this._signoutStart(e,this._redirectNavigator,n).then(function(){i.Log.info("UserManager.signoutRedirect: successful");})},e.prototype.signoutRedirectCallback=function t(e){return this._signoutEnd(e||this._redirectNavigator.url).then(function(t){return i.Log.info("UserManager.signoutRedirectCallback: successful"),t})},e.prototype.signoutPopup=function t(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};(e=Object.assign({},e)).request_type="so:p";var r=e.post_logout_redirect_uri||this.settings.popup_post_logout_redirect_uri||this.settings.post_logout_redirect_uri;return e.post_logout_redirect_uri=r,e.display="popup",e.post_logout_redirect_uri&&(e.state=e.state||{}),this._signout(e,this._popupNavigator,{startUrl:r,popupWindowFeatures:e.popupWindowFeatures||this.settings.popupWindowFeatures,popupWindowTarget:e.popupWindowTarget||this.settings.popupWindowTarget}).then(function(){i.Log.info("UserManager.signoutPopup: successful");})},e.prototype.signoutPopupCallback=function t(e,r){void 0===r&&"boolean"==typeof e&&(r=e,e=null);return this._popupNavigator.callback(e,r,"?").then(function(){i.Log.info("UserManager.signoutPopupCallback: successful");})},e.prototype._signout=function t(e,r){var n=this,i=arguments.length>2&&void 0!==arguments[2]?arguments[2]:{};return this._signoutStart(e,r,i).then(function(t){return n._signoutEnd(t.url)})},e.prototype._signoutStart=function t(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},r=this,n=arguments[1],o=arguments.length>2&&void 0!==arguments[2]?arguments[2]:{};return n.prepare(o).then(function(t){return i.Log.debug("UserManager._signoutStart: got navigator window handle"),r._loadUser().then(function(n){return i.Log.debug("UserManager._signoutStart: loaded current user from storage"),(r._settings.revokeAccessTokenOnSignout?r._revokeInternal(n):Promise.resolve()).then(function(){var s=e.id_token_hint||n&&n.id_token;return s&&(i.Log.debug("UserManager._signoutStart: Setting id_token into signout request"),e.id_token_hint=s),r.removeUser().then(function(){return i.Log.debug("UserManager._signoutStart: user removed, creating signout request"),r.createSignoutRequest(e).then(function(e){return i.Log.debug("UserManager._signoutStart: got signout request"),o.url=e.url,e.state&&(o.id=e.state.id),t.navigate(o)})})})}).catch(function(e){throw t.close&&(i.Log.debug("UserManager._signoutStart: Error after preparing navigator, closing navigator window"),t.close()),e})})},e.prototype._signoutEnd=function t(e){return this.processSignoutResponse(e).then(function(t){return i.Log.debug("UserManager._signoutEnd: got signout response"),t})},e.prototype.revokeAccessToken=function t(){var e=this;return this._loadUser().then(function(t){return e._revokeInternal(t,!0).then(function(r){if(r)return i.Log.debug("UserManager.revokeAccessToken: removing token properties from user and re-storing"),t.access_token=null,t.refresh_token=null,t.expires_at=null,t.token_type=null,e.storeUser(t).then(function(){i.Log.debug("UserManager.revokeAccessToken: user stored"),e._events.load(t);})})}).then(function(){i.Log.info("UserManager.revokeAccessToken: access token revoked successfully");})},e.prototype._revokeInternal=function t(e,r){var n=this;if(e){var o=e.access_token,s=e.refresh_token;return this._revokeAccessTokenInternal(o,r).then(function(t){return n._revokeRefreshTokenInternal(s,r).then(function(e){return t||e||i.Log.debug("UserManager.revokeAccessToken: no need to revoke due to no token(s), or JWT format"),t||e})})}return Promise.resolve(!1)},e.prototype._revokeAccessTokenInternal=function t(e,r){return !e||e.indexOf(".")>=0?Promise.resolve(!1):this._tokenRevocationClient.revoke(e,r).then(function(){return !0})},e.prototype._revokeRefreshTokenInternal=function t(e,r){return e?this._tokenRevocationClient.revoke(e,r,"refresh_token").then(function(){return !0}):Promise.resolve(!1)},e.prototype.startSilentRenew=function t(){this._silentRenewService.start();},e.prototype.stopSilentRenew=function t(){this._silentRenewService.stop();},e.prototype._loadUser=function t(){return this._userStore.get(this._userStoreKey).then(function(t){return t?(i.Log.debug("UserManager._loadUser: user storageString loaded"),a.User.fromStorageString(t)):(i.Log.debug("UserManager._loadUser: no user storageString"),null)})},e.prototype.storeUser=function t(e){if(e){i.Log.debug("UserManager.storeUser: storing user");var r=e.toStorageString();return this._userStore.set(this._userStoreKey,r)}return i.Log.debug("storeUser.storeUser: removing user"),this._userStore.remove(this._userStoreKey)},n(e,[{key:"_redirectNavigator",get:function t(){return this.settings.redirectNavigator}},{key:"_popupNavigator",get:function t(){return this.settings.popupNavigator}},{key:"_iframeNavigator",get:function t(){return this.settings.iframeNavigator}},{key:"_userStore",get:function t(){return this.settings.userStore}},{key:"events",get:function t(){return this._events}},{key:"_userStoreKey",get:function t(){return "user:"+this.settings.authority+":"+this.settings.client_id}}]),e}(o.OidcClient);},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.UserManagerSettings=void 0;var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),i=(r(0),r(5)),o=r(42),s=r(43),a=r(45),u=r(6),c=r(1),h=r(12);var l=60,f=2e3;e.UserManagerSettings=function(t){function e(){var r=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},n=r.popup_redirect_uri,i=r.popup_post_logout_redirect_uri,d=r.popupWindowFeatures,p=r.popupWindowTarget,g=r.silent_redirect_uri,v=r.silentRequestTimeout,y=r.automaticSilentRenew,m=void 0!==y&&y,_=r.validateSubOnSilentRenew,S=void 0!==_&&_,F=r.includeIdTokenInSilentRenew,b=void 0===F||F,w=r.monitorSession,E=void 0===w||w,x=r.checkSessionInterval,k=void 0===x?f:x,A=r.stopCheckSessionOnError,P=void 0===A||A,C=r.query_status_response_type,T=r.revokeAccessTokenOnSignout,R=void 0!==T&&T,I=r.accessTokenExpiringNotificationTime,D=void 0===I?l:I,L=r.redirectNavigator,U=void 0===L?new o.RedirectNavigator:L,B=r.popupNavigator,N=void 0===B?new s.PopupNavigator:B,O=r.iframeNavigator,j=void 0===O?new a.IFrameNavigator:O,H=r.userStore,M=void 0===H?new u.WebStorageStateStore({store:c.Global.sessionStorage}):H;!function K(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,e);var V=function q(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return !e||"object"!=typeof e&&"function"!=typeof e?t:e}(this,t.call(this,arguments[0]));return V._popup_redirect_uri=n,V._popup_post_logout_redirect_uri=i,V._popupWindowFeatures=d,V._popupWindowTarget=p,V._silent_redirect_uri=g,V._silentRequestTimeout=v,V._automaticSilentRenew=m,V._validateSubOnSilentRenew=S,V._includeIdTokenInSilentRenew=b,V._accessTokenExpiringNotificationTime=D,V._monitorSession=E,V._checkSessionInterval=k,V._stopCheckSessionOnError=P,C?V._query_status_response_type=C:arguments[0]&&arguments[0].response_type?V._query_status_response_type=h.SigninRequest.isOidc(arguments[0].response_type)?"id_token":"code":V._query_status_response_type="id_token",V._revokeAccessTokenOnSignout=R,V._redirectNavigator=U,V._popupNavigator=N,V._iframeNavigator=j,V._userStore=M,V}return function r(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e);}(e,t),n(e,[{key:"popup_redirect_uri",get:function t(){return this._popup_redirect_uri}},{key:"popup_post_logout_redirect_uri",get:function t(){return this._popup_post_logout_redirect_uri}},{key:"popupWindowFeatures",get:function t(){return this._popupWindowFeatures}},{key:"popupWindowTarget",get:function t(){return this._popupWindowTarget}},{key:"silent_redirect_uri",get:function t(){return this._silent_redirect_uri}},{key:"silentRequestTimeout",get:function t(){return this._silentRequestTimeout}},{key:"automaticSilentRenew",get:function t(){return this._automaticSilentRenew}},{key:"validateSubOnSilentRenew",get:function t(){return this._validateSubOnSilentRenew}},{key:"includeIdTokenInSilentRenew",get:function t(){return this._includeIdTokenInSilentRenew}},{key:"accessTokenExpiringNotificationTime",get:function t(){return this._accessTokenExpiringNotificationTime}},{key:"monitorSession",get:function t(){return this._monitorSession}},{key:"checkSessionInterval",get:function t(){return this._checkSessionInterval}},{key:"stopCheckSessionOnError",get:function t(){return this._stopCheckSessionOnError}},{key:"query_status_response_type",get:function t(){return this._query_status_response_type}},{key:"revokeAccessTokenOnSignout",get:function t(){return this._revokeAccessTokenOnSignout}},{key:"redirectNavigator",get:function t(){return this._redirectNavigator}},{key:"popupNavigator",get:function t(){return this._popupNavigator}},{key:"iframeNavigator",get:function t(){return this._iframeNavigator}},{key:"userStore",get:function t(){return this._userStore}}]),e}(i.OidcClientSettings);},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.RedirectNavigator=void 0;var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),i=r(0);e.RedirectNavigator=function(){function t(){!function e(t,r){if(!(t instanceof r))throw new TypeError("Cannot call a class as a function")}(this,t);}return t.prototype.prepare=function t(){return Promise.resolve(this)},t.prototype.navigate=function t(e){return e&&e.url?(e.useReplaceToNavigate?window.location.replace(e.url):window.location=e.url,Promise.resolve()):(i.Log.error("RedirectNavigator.navigate: No url provided"),Promise.reject(new Error("No url provided")))},n(t,[{key:"url",get:function t(){return window.location.href}}]),t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.PopupNavigator=void 0;var n=r(0),i=r(44);e.PopupNavigator=function(){function t(){!function e(t,r){if(!(t instanceof r))throw new TypeError("Cannot call a class as a function")}(this,t);}return t.prototype.prepare=function t(e){var r=new i.PopupWindow(e);return Promise.resolve(r)},t.prototype.callback=function t(e,r,o){n.Log.debug("PopupNavigator.callback");try{return i.PopupWindow.notifyOpener(e,r,o),Promise.resolve()}catch(t){return Promise.reject(t)}},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.PopupWindow=void 0;var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),i=r(0),o=r(3);var s=500,a="location=no,toolbar=no,width=500,height=500,left=100,top=100;",u="_blank";e.PopupWindow=function(){function t(e){var r=this;!function n(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this._promise=new Promise(function(t,e){r._resolve=t,r._reject=e;});var o=e.popupWindowTarget||u,c=e.popupWindowFeatures||a;this._popup=window.open("",o,c),this._popup&&(i.Log.debug("PopupWindow.ctor: popup successfully created"),this._checkForPopupClosedTimer=window.setInterval(this._checkForPopupClosed.bind(this),s));}return t.prototype.navigate=function t(e){return this._popup?e&&e.url?(i.Log.debug("PopupWindow.navigate: Setting URL in popup"),this._id=e.id,this._id&&(window["popupCallback_"+e.id]=this._callback.bind(this)),this._popup.focus(),this._popup.window.location=e.url):(this._error("PopupWindow.navigate: no url provided"),this._error("No url provided")):this._error("PopupWindow.navigate: Error opening popup window"),this.promise},t.prototype._success=function t(e){i.Log.debug("PopupWindow.callback: Successful response from popup window"),this._cleanup(),this._resolve(e);},t.prototype._error=function t(e){i.Log.error("PopupWindow.error: ",e),this._cleanup(),this._reject(new Error(e));},t.prototype.close=function t(){this._cleanup(!1);},t.prototype._cleanup=function t(e){i.Log.debug("PopupWindow.cleanup"),window.clearInterval(this._checkForPopupClosedTimer),this._checkForPopupClosedTimer=null,delete window["popupCallback_"+this._id],this._popup&&!e&&this._popup.close(),this._popup=null;},t.prototype._checkForPopupClosed=function t(){this._popup&&!this._popup.closed||this._error("Popup window closed");},t.prototype._callback=function t(e,r){this._cleanup(r),e?(i.Log.debug("PopupWindow.callback success"),this._success({url:e})):(i.Log.debug("PopupWindow.callback: Invalid response from popup"),this._error("Invalid response from popup"));},t.notifyOpener=function t(e,r,n){if(window.opener){if(e=e||window.location.href){var s=o.UrlUtility.parseUrlFragment(e,n);if(s.state){var a="popupCallback_"+s.state,u=window.opener[a];u?(i.Log.debug("PopupWindow.notifyOpener: passing url message to opener"),u(e,r)):i.Log.warn("PopupWindow.notifyOpener: no matching callback found on opener");}else i.Log.warn("PopupWindow.notifyOpener: no state found in response url");}}else i.Log.warn("PopupWindow.notifyOpener: no window.opener. Can't complete notification.");},n(t,[{key:"promise",get:function t(){return this._promise}}]),t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.IFrameNavigator=void 0;var n=r(0),i=r(46);e.IFrameNavigator=function(){function t(){!function e(t,r){if(!(t instanceof r))throw new TypeError("Cannot call a class as a function")}(this,t);}return t.prototype.prepare=function t(e){var r=new i.IFrameWindow(e);return Promise.resolve(r)},t.prototype.callback=function t(e){n.Log.debug("IFrameNavigator.callback");try{return i.IFrameWindow.notifyParent(e),Promise.resolve()}catch(t){return Promise.reject(t)}},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.IFrameWindow=void 0;var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),i=r(0);e.IFrameWindow=function(){function t(e){var r=this;!function n(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this._promise=new Promise(function(t,e){r._resolve=t,r._reject=e;}),this._boundMessageEvent=this._message.bind(this),window.addEventListener("message",this._boundMessageEvent,!1),this._frame=window.document.createElement("iframe"),this._frame.style.visibility="hidden",this._frame.style.position="absolute",this._frame.style.display="none",this._frame.style.width=0,this._frame.style.height=0,window.document.body.appendChild(this._frame);}return t.prototype.navigate=function t(e){if(e&&e.url){var r=e.silentRequestTimeout||1e4;i.Log.debug("IFrameWindow.navigate: Using timeout of:",r),this._timer=window.setTimeout(this._timeout.bind(this),r),this._frame.src=e.url;}else this._error("No url provided");return this.promise},t.prototype._success=function t(e){this._cleanup(),i.Log.debug("IFrameWindow: Successful response from frame window"),this._resolve(e);},t.prototype._error=function t(e){this._cleanup(),i.Log.error(e),this._reject(new Error(e));},t.prototype.close=function t(){this._cleanup();},t.prototype._cleanup=function t(){this._frame&&(i.Log.debug("IFrameWindow: cleanup"),window.removeEventListener("message",this._boundMessageEvent,!1),window.clearTimeout(this._timer),window.document.body.removeChild(this._frame),this._timer=null,this._frame=null,this._boundMessageEvent=null);},t.prototype._timeout=function t(){i.Log.debug("IFrameWindow.timeout"),this._error("Frame window timed out");},t.prototype._message=function t(e){if(i.Log.debug("IFrameWindow.message"),this._timer&&e.origin===this._origin&&e.source===this._frame.contentWindow){var r=e.data;r?this._success({url:r}):this._error("Invalid response from frame");}},t.notifyParent=function t(e){i.Log.debug("IFrameWindow.notifyParent"),window.frameElement&&(e=e||window.location.href)&&(i.Log.debug("IFrameWindow.notifyParent: posting url message to parent"),window.parent.postMessage(e,location.protocol+"//"+location.host));},n(t,[{key:"promise",get:function t(){return this._promise}},{key:"_origin",get:function t(){return location.protocol+"//"+location.host}}]),t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.UserManagerEvents=void 0;var n=r(0),i=r(16),o=r(17);e.UserManagerEvents=function(t){function e(r){!function n(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,e);var i=function s(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return !e||"object"!=typeof e&&"function"!=typeof e?t:e}(this,t.call(this,r));return i._userLoaded=new o.Event("User loaded"),i._userUnloaded=new o.Event("User unloaded"),i._silentRenewError=new o.Event("Silent renew error"),i._userSignedOut=new o.Event("User signed out"),i._userSessionChanged=new o.Event("User session changed"),i}return function r(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e);}(e,t),e.prototype.load=function e(r){var i=!(arguments.length>1&&void 0!==arguments[1])||arguments[1];n.Log.debug("UserManagerEvents.load"),t.prototype.load.call(this,r),i&&this._userLoaded.raise(r);},e.prototype.unload=function e(){n.Log.debug("UserManagerEvents.unload"),t.prototype.unload.call(this),this._userUnloaded.raise();},e.prototype.addUserLoaded=function t(e){this._userLoaded.addHandler(e);},e.prototype.removeUserLoaded=function t(e){this._userLoaded.removeHandler(e);},e.prototype.addUserUnloaded=function t(e){this._userUnloaded.addHandler(e);},e.prototype.removeUserUnloaded=function t(e){this._userUnloaded.removeHandler(e);},e.prototype.addSilentRenewError=function t(e){this._silentRenewError.addHandler(e);},e.prototype.removeSilentRenewError=function t(e){this._silentRenewError.removeHandler(e);},e.prototype._raiseSilentRenewError=function t(e){n.Log.debug("UserManagerEvents._raiseSilentRenewError",e.message),this._silentRenewError.raise(e);},e.prototype.addUserSignedOut=function t(e){this._userSignedOut.addHandler(e);},e.prototype.removeUserSignedOut=function t(e){this._userSignedOut.removeHandler(e);},e.prototype._raiseUserSignedOut=function t(){n.Log.debug("UserManagerEvents._raiseUserSignedOut"),this._userSignedOut.raise();},e.prototype.addUserSessionChanged=function t(e){this._userSessionChanged.addHandler(e);},e.prototype.removeUserSessionChanged=function t(e){this._userSessionChanged.removeHandler(e);},e.prototype._raiseUserSessionChanged=function t(){n.Log.debug("UserManagerEvents._raiseUserSessionChanged"),this._userSessionChanged.raise();},e}(i.AccessTokenEvents);},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.Timer=void 0;var n=function(){function t(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n);}}return function(e,r,n){return r&&t(e.prototype,r),n&&t(e,n),e}}(),i=r(0),o=r(1),s=r(17);e.Timer=function(t){function e(r){var n=arguments.length>1&&void 0!==arguments[1]?arguments[1]:o.Global.timer,i=arguments.length>2&&void 0!==arguments[2]?arguments[2]:void 0;!function s(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,e);var a=function u(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return !e||"object"!=typeof e&&"function"!=typeof e?t:e}(this,t.call(this,r));return a._timer=n,a._nowFunc=i||function(){return Date.now()/1e3},a}return function r(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e);}(e,t),e.prototype.init=function t(e){e<=0&&(e=1),e=parseInt(e);var r=this.now+e;if(this.expiration===r&&this._timerHandle)i.Log.debug("Timer.init timer "+this._name+" skipping initialization since already initialized for expiration:",this.expiration);else{this.cancel(),i.Log.debug("Timer.init timer "+this._name+" for duration:",e),this._expiration=r;var n=5;e<n&&(n=e),this._timerHandle=this._timer.setInterval(this._callback.bind(this),1e3*n);}},e.prototype.cancel=function t(){this._timerHandle&&(i.Log.debug("Timer.cancel: ",this._name),this._timer.clearInterval(this._timerHandle),this._timerHandle=null);},e.prototype._callback=function e(){var r=this._expiration-this.now;i.Log.debug("Timer.callback; "+this._name+" timer expires in:",r),this._expiration<=this.now&&(this.cancel(),t.prototype.raise.call(this));},n(e,[{key:"now",get:function t(){return parseInt(this._nowFunc())}},{key:"expiration",get:function t(){return this._expiration}}]),e}(s.Event);},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.SilentRenewService=void 0;var n=r(0);e.SilentRenewService=function(){function t(e){!function r(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this._userManager=e;}return t.prototype.start=function t(){this._callback||(this._callback=this._tokenExpiring.bind(this),this._userManager.events.addAccessTokenExpiring(this._callback),this._userManager.getUser().then(function(t){}).catch(function(t){n.Log.error("SilentRenewService.start: Error from getUser:",t.message);}));},t.prototype.stop=function t(){this._callback&&(this._userManager.events.removeAccessTokenExpiring(this._callback),delete this._callback);},t.prototype._tokenExpiring=function t(){var e=this;this._userManager.signinSilent().then(function(t){n.Log.debug("SilentRenewService._tokenExpiring: Silent token renewal successful");},function(t){n.Log.error("SilentRenewService._tokenExpiring: Error from signinSilent:",t.message),e._userManager.events._raiseSilentRenewError(t);});},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.CordovaPopupNavigator=void 0;var n=r(21);e.CordovaPopupNavigator=function(){function t(){!function e(t,r){if(!(t instanceof r))throw new TypeError("Cannot call a class as a function")}(this,t);}return t.prototype.prepare=function t(e){var r=new n.CordovaPopupWindow(e);return Promise.resolve(r)},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0}),e.CordovaIFrameNavigator=void 0;var n=r(21);e.CordovaIFrameNavigator=function(){function t(){!function e(t,r){if(!(t instanceof r))throw new TypeError("Cannot call a class as a function")}(this,t);}return t.prototype.prepare=function t(e){e.popupWindowFeatures="hidden=yes";var r=new n.CordovaPopupWindow(e);return Promise.resolve(r)},t}();},function(t,e,r){Object.defineProperty(e,"__esModule",{value:!0});e.Version="1.9.1";}])});
    });

    var Oidc = unwrapExports(oidcClient_min);

    // import App from './App.svelte';

    //const app = new App({target: document.body});

    // app.$on('login', () => {
        // login();
    // });

    // app.$on('logout', () => {
        // logout();
    // });

    // app.$on('mvc', async () => {
        // const response = await mvc_api();
        // console.log(response);
    // });

    var authIP = '192.168.7.201';
    if (location.search.indexOf('local')) { authIP = 'localhost'; }
    var config = {
        authority: `https://${authIP}:5001`,
        client_id: "spa",
        redirect_uri: "https://maps.kosmosnimki.ru/api/plugins/external/gmxPluginOuth2/public/callback.html",
        response_type: "code",
        scope:"openid profile email api1",
        post_logout_redirect_uri : "https://maps.kosmosnimki.ru/api/index.html?NKL6C",
    };

    var mgr = new Oidc.UserManager(config);

    mgr.getUser().then(function (user) {
    console.log('sssssss', user);
        if (user) {
            app.$set({'loggedIn': true, 'userInfo': {name: user.profile.name}});
        }    
    });
        mgr.signinRedirect();

    exports.App = App;

    return exports;

}({}));
//# sourceMappingURL=gmxPluginOuth2.js.map
