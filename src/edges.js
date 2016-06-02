var edges = {

    //////////////////////////////////////////////////////
    // main function to run to start a new Edge

    newEdge : function(params) {
        if (!params) { params = {} }
        return new edges.Edge(params);
    },
    Edge : function(params) {

        /////////////////////////////////////////////
        // parameters that can be set via params arg

        // the jquery selector for the element where the edge will be deployed
        this.selector = params.selector || "body";

        // the base search url which will respond to elasticsearch queries.  Generally ends with _search
        this.search_url = edges.getParam(params.search_url, false);

        // datatype for ajax requests to use - overall recommend using jsonp
        this.datatype = params.datatype || "jsonp";

        // dictionary of queries to be run before the primary query is executed
        // {"<preflight id>" : es.newQuery(....)}
        // results will appear with the same ids in this.preflightResults
        // preflight queries are /not/ subject to the base query
        this.preflightQueries = edges.getParam(params.preflightQueries, false);

        // query that forms the basis of all queries that are assembled and run
        // Note that baseQuery is inviolable - it's requirements will always be enforced
        this.baseQuery = params.baseQuery || false;

        // query to use to initialise the search.  Use this to set your opening
        // values for things like page size, initial search terms, etc.  Any request to
        // reset the interface will return to this query
        this.openingQuery = params.openingQuery || es.newQuery();

        // dictionary of functions that will generate secondary queries which also need to be
        // run at the point that cycle() is called.  These functions and their resulting
        // queries will be run /after/ the primary query (so can take advantage of the
        // results).  Their results will be stored in this.secondaryResults.
        // secondary queries are not subject the base query, although the functions
        // may of course apply the base query too if they wish
        this.secondaryQueries = edges.getParam(params.secondaryQueries, false);

        // should the init process do a search
        this.initialSearch = edges.getParam(params.initialSearch, true);

        // list of static files (e.g. data files) to be loaded at startup, and made available
        // on the object for use by components
        // {"id" : "<internal id to give the file>", "url" : "<file url>", "processor" : edges.csv.ObjectByRow, "datatype" : "text"}
        this.staticFiles = edges.getParam(params.staticFiles, []);

        // should the search url be synchronised with the browser's url bar after search
        // and should queries be retrieved from the url on init
        this.manageUrl = params.manageUrl || false;

        // query parameter in which the query for this edge instance will be stored
        this.urlQuerySource = params.urlQuerySource || "source";

        // template object that will be used to draw the frame for the edge.  May be left
        // blank, in which case the edge will assume that the elements are already rendered
        // on the page by the caller
        this.template = params.template || false;

        // list of all the components that are involved in this edge
        this.components = params.components || [];

        // render packs to use to source automatically assigned rendering objects
        this.renderPacks = params.renderPacks || [edges.bs3, edges.nvd3, edges.highcharts, edges.google, edges.d3];

        /////////////////////////////////////////////
        // operational properties

        // the query most recently read from the url
        this.urlQuery = false;

        // original url parameters
        this.urlParams = {};

        // the short url for this page
        this.shortUrl = false;

        // the last primary ES query object that was executed
        this.currentQuery = false;

        // the last result object from the ES layer
        this.result = false;

        // the results of the preflight queries, keyed by their id
        this.preflightResults = {};

        // results of the secondary queries, keyed by their id
        this.secondaryResults = {};

        // if the search is currently executing
        this.searching = false;

        // jquery object that represents the selected element
        this.context = false;

        // raw access to this.staticFiles loaded resources, keyed by id
        this.static = {};

        // access to processed static files, keyed by id
        this.resources = {};

        // list of static resources where errors were encountered
        this.errorLoadingStatic = [];

        ////////////////////////////////////////////////////////
        // startup functions

        // at the bottom of this constructor, we'll call this function
        this.startup = function() {
            // obtain the jquery context for all our operations
            this.context = $(this.selector);

            // trigger the edges:init event
            this.context.trigger("edges:pre-init");

            // if we are to manage the URL, attempt to pull a query from it
            if (this.manageUrl) {
                var urlParams = this.getUrlParams();
                if (this.urlQuerySource in urlParams) {
                    this.urlQuery = es.newQuery({raw : urlParams[this.urlQuerySource]});
                    delete urlParams[this.urlQuerySource];
                }
                this.urlParams = urlParams;
            }

            // render the template if necessary
            if (this.template) {
                this.template.draw(this);
            }

            // call each of the components to initialise themselves
            for (var i = 0; i < this.components.length; i++) {
                var component = this.components[i];
                component.init(this);
            }

            // now call each component to render itself (pre-search)
            this.draw();

            // load any static files - this will happen asynchronously, so afterwards
            // we call finaliseStartup to finish the process
            var onward = edges.objClosure(this, "startupPart2");
            this.loadStaticsAsync(onward);
        };

        this.startupPart2 = function() {
            // FIXME: at this point we should check whether the statics all loaded correctly
            var onward = edges.objClosure(this, "startupPart3");
            this.runPreflightQueries(onward);
        };

        this.startupPart3 = function() {
            // determine whether to initialise with either the openingQuery or the urlQuery
            var requestedQuery = this.openingQuery;
            if (this.urlQuery) {
                // if there is a URL query, then we open with that, and then forget it
                requestedQuery = this.urlQuery;
                this.urlQuery = false
            }

            // request the components to contribute to the query
            for (var i = 0; i < this.components.length; i++) {
                var component = this.components[i];
                component.contrib(requestedQuery);
            }

            // finally push the query, which will reconcile it with the baseQuery
            this.pushQuery(requestedQuery);

            // trigger the edges:started event
            this.context.trigger("edges:post-init");

            // now issue a query
            // this.doQuery();
            this.cycle();
        };

        /////////////////////////////////////////////////////////
        // Edges lifecycle functions

        this.doQuery = function() {
            // the original doQuery has become doPrimaryQuery, so this has been aliased for this.cycle
            this.cycle();
        };

        this.cycle = function() {
            // if a search is currently executing, don't do anything, else turn it on
            // FIXME: should we queue them up?
            if (this.searching) {
                return;
            }
            this.searching = true;

            // invalidate the short url
            this.shortUrl = false;

            // pre query event
            this.context.trigger("edges:pre-query");

            // if we are managing the url space, use pushState to set it
            if (this.manageUrl) {
                this.updateUrl();
            }

            // if there's a search url, do a query, otherwise call synchronise and draw directly
            if (this.search_url) {
                var onward = edges.objClosure(this, "cyclePart2");
                this.doPrimaryQuery(onward);
            } else {
                this.cyclePart2();
            }
        };

        this.cyclePart2 = function() {
            // find out if there are any secondary queries to run
            var queries = [];
            if (this.secondaryQueries && this.secondaryQueries.length > 0) {
                for (var i = 0; i < this.secondaryQueries.length; i++) {
                    queries.push(this.secondaryQueries[i](this));
                }
                var onward = edges.objClosure(this, "finaliseCycle");
                this.runSecondaryQueries(queries, onward);
            }

            this.synchronise();

            // pre-render trigger
            this.context.trigger("edges:pre-render");
            // render
            this.draw();
            // post render trigger
            this.context.trigger("edges:post-render");

            // searching has completed, so flip the switch back
            this.searching = false;
        };

        this.synchronise = function() {
            // ask the components to synchronise themselves with the latest state
            for (var i = 0; i < this.components.length; i++) {
                var component = this.components[i];
                component.synchronise()
            }
        };

        this.draw = function() {
            for (var i = 0; i < this.components.length; i++) {
                var component = this.components[i];
                component.draw(this);
            }
        };

        // reset the query to the start and re-issue the query
        this.reset = function() {
            // tell the world we're about to reset
            this.context.trigger("edges:pre-reset");

            // clone from the opening query
            var requestedQuery = this.cloneOpeningQuery();

            // request the components to contribute to the query
            for (var i = 0; i < this.components.length; i++) {
                var component = this.components[i];
                component.contrib(requestedQuery);
            }

            // push the query, which will reconcile it with the baseQuery
            this.pushQuery(requestedQuery);

            // tell the world that we've done the reset
            this.context.trigger("edges:post-reset");

            // now execute the query
            // this.doQuery();
            this.cycle();
        };

        ////////////////////////////////////////////////////
        // functions to handle the query lifecycle

        this.cloneQuery = function() {
            return $.extend(true, {}, this.currentQuery);
        };

        this.pushQuery = function(query) {
            if (this.baseQuery) {
                query.merge(this.baseQuery);
            }
            this.currentQuery = query;
        };

        this.cloneBaseQuery = function() {
            if (this.baseQuery) {
                return $.extend(true, {}, this.baseQuery);
            }
            return es.newQuery();
        };

        this.cloneOpeningQuery = function() {
            if (this.openingQuery) {
                return $.extend(true, {}, this.openingQuery);
            }
            return es.newQuery();
        };

        // execute the query and all the associated workflow
        this.doPrimaryQuery = function(callback) {
            var context = {"callback" : callback};

            // issue the query to elasticsearch
            es.doQuery({
                search_url: this.search_url,
                queryobj: this.currentQuery.objectify(),
                datatype: this.datatype,
                success: edges.objClosure(this, "querySuccess", ["result"], context),
                error: edges.objClosure(this, "queryFail", context) //,
                // complete: edges.objClosure(this, "queryComplete", context)
            })
        };
        /*
        this.doPrimaryQuery = function() {
            // we only want to trigger ES queries if there's a query url
            if (!this.search_url) {
                return;
            }

            // if a search is currently executing, don't do anything, else turn it on
            // FIXME: should we queue them up?
            if (this.searching) {
                return;
            }
            this.searching = true;

            // invalidate the short url
            this.shortUrl = false;

            // pre query event
            this.context.trigger("edges:pre-query");

            // if we are managing the url space, use pushState to set it
            if (this.manageUrl) {
                this.updateUrl();
            }

            // issue the query to elasticsearch
            es.doQuery({
                search_url: this.search_url,
                queryobj: this.currentQuery.objectify(),
                datatype: this.datatype,
                success: edges.objClosure(this, "querySuccess", ["result"]),
                error: edges.objClosure(this, "queryFail"),
                complete: edges.objClosure(this, "queryComplete")
            })
        };*/

        this.queryFail = function(params) {
            var callback = params.context;
            this.context.trigger("edges:query-fail");
            callback();
        };

        this.querySuccess = function(params) {
            this.result = params.result;
            var callback = params.callback;

            // success trigger
            this.context.trigger("edges:query-success");
            callback();
        };

        /*
        this.queryComplete = function() {
            // pre-render trigger
            this.context.trigger("edges:pre-render");

            for (var i = 0; i < this.components.length; i++) {
                var component = this.components[i];
                component.draw();
            }

            // post render trigger
            this.context.trigger("edges:post-render");

            // searching has completed, so flip the switch back
            this.searching = false;
        };
        */

        this.runPreflightQueries = function(callback) {
            callback();
        };

        this.runSecondaryQueries = function(queries, callback) {
            var that = this;
            var pg = edges.newAsyncGroup({
                list: queries,
                action: function(params) {
                    var entry = params.entry;
                    var success = params.success_callback;
                    var error = params.error_callback;

                    es.doQuery({
                        search_url: that.search_url,
                        queryobj: entry,
                        datatype: that.datatype,
                        success: success,
                        complete: false
                    });
                },
                successCallbackArgs: ["result"],
                success: function(params) {
                    var result = params.result;
                    var entry = params.entry;
                    // FIXME: carry on ...
                },
                errorCallbackArgs : ["result"],
                error:  function(params) {
                    that.errorLoadingStatic.push(params.entry.id);
                    that.context.trigger("edges:error-load-static");
                },
                carryOn: function() {
                    that.context.trigger("edges:post-load-static");
                    callback();
                }
            });

            pg.process();
        };

        ////////////////////////////////////////////////
        // various utility functions

        // return components in the requested category
        this.category = function(cat) {
            var comps = [];
            for (var i = 0; i < this.components.length; i++) {
                var component = this.components[i];
                if (component.category === cat) {
                    comps.push(component);
                }
            }
            return comps;
        };

        this.getRenderPackObject = function(oname, params) {
            for (var i = 0; i < this.renderPacks.length; i++) {
                var rp = this.renderPacks[i];
                if (rp && rp.hasOwnProperty(oname)) {
                    return rp[oname](params);
                }
            }

        };

        // get the jquery object for the desired element, in the correct context
        // you should ALWAYS use this, rather than the standard jquery $ object
        this.jq = function(selector) {
            return $(selector, this.context);
        };

        /////////////////////////////////////////////////////
        // URL management functions

        this.getUrlParams = function() {
            var params = {};
            var url = window.location.href;
            var fragment = false;

            // break the anchor off the url
            if (url.indexOf("#") > -1) {
                fragment = url.slice(url.indexOf('#'));
                url = url.substring(0, url.indexOf('#'));
            }

            // extract and split the query args
            var args = url.slice(url.indexOf('?') + 1).split('&');

            for (var i = 0; i < args.length; i++) {
                var kv = args[i].split('=');
                if (kv.length === 2) {
                    var val = decodeURIComponent(kv[1]);
                    if (val[0] == "[" || val[0] == "{") {
                        // if it looks like a JSON object in string form...
                        // remove " (double quotes) at beginning and end of string to make it a valid
                        // representation of a JSON object, or the parser will complain
                        val = val.replace(/^"/,"").replace(/"$/,"");
                        val = JSON.parse(val);
                    }
                    params[kv[0]] = val;
                }
            }

            // record the fragment identifier if required
            if (fragment) {
                params['#'] = fragment;
            }

            return params;
        };

        this.urlQueryArg = function(objectify_options) {
            if (!objectify_options) {
                objectify_options = {
                    include_query_string : true,
                    include_filters : true,
                    include_paging : true,
                    include_sort : true,
                    include_fields : false,
                    include_aggregations : false,
                    include_facets : false
                }
            }
            var q = JSON.stringify(this.currentQuery.objectify(objectify_options));
            var obj = {};
            obj[this.urlQuerySource] = encodeURIComponent(q);
            return obj;
        };

        this.fullQueryArgs = function() {
            var args = $.extend(true, {}, this.urlParams);
            $.extend(args, this.urlQueryArg());
            return args;
        };

        this.fullUrlQueryString = function() {
            return this._makeUrlQuery(this.fullQueryArgs())
        };

        this._makeUrlQuery = function(args) {
            var keys = Object.keys(args);
            var entries = [];
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var val = args[key];
                entries.push(key + "=" + val);  // NOTE we do not escape - this should already be done
            }
            return entries.join("&");
        };

        this.fullUrl = function() {
            var args = this.fullQueryArgs();
            var fragment = "";
            if (args["#"]) {
                fragment = "#" + args["#"];
                delete args["#"];
            }
            var wloc = window.location.toString();
            var bits = wloc.split("?");
            var url = bits[0] + "?" + this._makeUrlQuery(args) + fragment;
            return url;
        };

        this.updateUrl = function() {
            if ('pushState' in window.history) {
                var qs = "?" + this.fullUrlQueryString();
                window.history.pushState("", "", qs);
            }
        };

        /////////////////////////////////////////////
        // static file management

        this.loadStaticsAsync = function(callback) {
            if (this.staticFiles.length == 0) {
                this.context.trigger("edges:post-load-static");
                callback();
            }

            var that = this;
            var pg = edges.newAsyncGroup({
                list: this.staticFiles,
                action: function(params) {
                    var entry = params.entry;
                    var success = params.success_callback;
                    var error = params.error_callback;

                    var id = entry.id;
                    var url = entry.url;
                    var datatype = edges.getParam(entry.datatype, "text");

                    $.ajax({
                        type: "get",
                        url: url,
                        dataType: datatype,
                        success: success,
                        error: error
                    })
                },
                successCallbackArgs: ["data"],
                success: function(params) {
                    var data = params.data;
                    var entry = params.entry;
                    if (entry.processor) {
                        var processed = entry.processor({data : data});
                        that.resources[entry.id] = processed;
                    }
                    that.static[entry.id] = data;
                },
                errorCallbackArgs : ["data"],
                error:  function(params) {
                    that.errorLoadingStatic.push(params.entry.id);
                    that.context.trigger("edges:error-load-static");
                },
                carryOn: function() {
                    that.context.trigger("edges:post-load-static");
                    callback();
                }
            });

            pg.process();
        };

        /*
        this.loadStaticFiles = function(callback) {
            this.context.trigger("edges:pre-load-static");

            if (this.staticFiles.length == 0) {
                this.staticLoaded = true;
                this.context.trigger("edges:post-load-static");
                callback();
            }
            for (var i = 0; i < this.staticFiles.length; i++) {
                var id = this.staticFiles[i].id;
                var url = this.staticFiles[i].url;
                var datatype = edges.getParam(this.staticFiles[i].datatype, "text");
                var context = {id: id, callback: callback};

                $.ajax({
                    type: "get",
                    url: url,
                    dataType: datatype,
                    success: edges.objClosure(this, "staticFileLoaded", ["data"], context),
                    error: edges.objClosure(this, "staticFileError", ["data"], context)
                })
            }
        };

        this.staticFileLoaded = function(params) {
            var id = params.id;
            for (var i = 0; i < this.staticFiles.length; i++) {
                var sfRecord = this.staticFiles[i];
                if (sfRecord.processor) {
                    var processed = sfRecord.processor({data : params.data});
                    this.resources[id] = processed;
                    break;
                }
            }
            this.static[id] = params.data;
            if (this.allStaticsResolved()) {
                this.finishStaticLoad(params.callback);
            }
        };

        this.staticFileError = function(params) {
            this.errorLoadingStatic.push(params.id);
            this.staticError = true;
            this.context.trigger("edges:error-load-static");
        };

        this.allStaticsResolved = function() {
            for (var i = 0; i < this.staticFiles.length; i++) {
                var id = this.staticFiles[i].id;
                var loaded = id in this.static;
                var errored = $.inArray(id, this.errorLoadingStatic) > -1;
                if (!loaded && !errored) {
                    return false;
                }
            }
            return true;
        };

        this.finishStaticLoad = function(callback) {
            // just in case there's a race condition, rely on the actual object state to stop us
            if (this.staticLoaded) {
                return;
            }
            this.staticLoaded = true;
            this.context.trigger("edges:post-load-static");
            callback();
        };*/

        /////////////////////////////////////////////
        // final bits of construction
        this.startup();
    },

    //////////////////////////////////////////////////
    // Asynchronous resource loading feature

    newAsyncGroup : function(params) {
        if (!params) { params = {} }
        return new edges.AsyncGroup(params);
    },
    AsyncGroup : function(params) {
        this.list = params.list;
        this.successCallbackArgs = params.successCallbackArgs;
        this.errorCallbackArgs = params.errorCallbackArgs;

        var action = params.action;
        var success = params.success;
        var carryOn = params.carryOn;
        var error = params.error;

        this.functions = {
            action: action,
            success: success,
            carryOn: carryOn,
            error: error
        };

        this.checkList = [];

        this.finished = false;

        this.construct = function(params) {
            for (var i = 0; i < this.list.length; i++) {
                this.checkList.push(0);
            }
        };

        this.process = function(params) {
            if (this.list.length == 0) {
                this.functions.carryOn();
            }

            for (var i = 0; i < this.list.length; i++) {
                var context = {index: i};

                var success_callback = edges.objClosure(this, "_actionSuccess", this.successCallbackArgs, context);
                var error_callback = edges.objClosure(this, "_actionError", this.successCallbackArgs, context);
                var complete_callback = false;

                this.functions.action({entry: this.list[i],
                    success_callback: success_callback,
                    error_callback: error_callback,
                    complete_callback: complete_callback
                });
            }
        };

        this._actionSuccess = function(params) {
            var index = params.index;
            delete params.index;

            params["entry"] = this.list[index];
            this.functions.success(params);
            this.checkList[index] = 1;

            if (this._isComplete()) {
                this._finalise();
            }
        };

        this._actionError = function(params) {
            var index = params.index;
            delete params.index;

            params["entry"] = this.list[index];
            this.functions.error(params);
            this.checkList[index] = -1;

            if (this._isComplete()) {
                this._finalise();
            }
        };

        this._actionComplete = function(params) {

        };

        this._isComplete = function() {
            return $.inArray(0, this.checkList) === -1;
        };

        this._finalise = function() {
            if (this.finished) {
                return;
            }
            this.finished = true;
            this.functions.carryOn();
        };

        ////////////////////////////////////////
        this.construct();
    },

    /////////////////////////////////////////////
    // Base classes for the various kinds of components

    newRenderer : function(params) {
        if (!params) { params = {} }
        return new edges.Renderer(params);
    },
    Renderer : function(params) {
        this.component = params.component || false;
        this.init = function(component) {
            this.component = component
        };
        this.draw = function(component) {}
    },

    newComponent : function(params) {
        if (!params) { params = {} }
        return new edges.Component(params);
    },
    Component : function(params) {
        this.id = params.id;
        this.renderer = params.renderer;
        this.category = params.category || "none";
        this.defaultRenderer = params.defaultRenderer || "newRenderer";

        this.init = function(edge) {
            // record a reference to the parent object
            this.edge = edge;
            this.context = this.edge.jq("#" + this.id);

            // set the renderer from default if necessary
            if (!this.renderer) {
                this.renderer = this.edge.getRenderPackObject(this.defaultRenderer);
            }
            if (this.renderer) {
                this.renderer.init(this);
            }
        };

        this.draw = function() {
            if (this.renderer) {
                this.renderer.draw();
            }
        };

        this.contrib = function(query) {};
        this.synchronise = function() {};

        // convenience method for any renderer rendering a component
        this.jq = function(selector) {
            return this.edge.jq(selector);
        }
    },

    newSelector : function(params) {
        if (!params) { params = {} }
        edges.Selector.prototype = edges.newComponent(params);
        return new edges.Selector(params);
    },
    Selector : function(params) {
        // field upon which to build the selector
        this.field = params.field;

        // display name for the UI
        this.display = params.display || this.field;

        // whether the facet should be displayed at all (e.g. you may just want the data for a callback)
        this.active = params.active || true;

        // whether the facet should be acted upon in any way.  This might be useful if you want to enable/disable facets under different circumstances via a callback
        this.disabled = params.disabled || false;

        this.category = params.category || "selector";
    },

    newTemplate : function(params) {
        if (!params) { params = {} }
        return new edges.Template(params);
    },
    Template : function(params) {
        this.draw = function(edge) {}
    },

    //////////////////////////////////////////////////////////////////
    // Closures for integrating the object with other modules

    // returns a function that will call the named function (fn) on
    // a specified object instance (obj), with all "arguments"
    // supplied to the closure by the caller
    //
    // if the args property is specified here, instead a parameters object
    // will be constructed with a one to one mapping between the names in args
    // and the values in the "arguments" supplied to the closure, until all
    // values in "args" are exhausted.
    //
    // so, for example,
    //
    // objClosure(this, "function")(arg1, arg2, arg3)
    // results in a call to
    // this.function(arg1, arg2, arg3, ...)
    //
    // and
    // objClosure(this, "function", ["one", "two"])(arg1, arg2, arg3)
    // results in a call to
    // this.function({one: arg1, two: arg2})
    //
    objClosure : function(obj, fn, args, context_params) {
        return function() {
            if (args) {
                var params = {};
                for (var i = 0; i < args.length; i++) {
                    if (arguments.length > i) {
                        params[args[i]] = arguments[i];
                    }
                }
                if (context_params) {
                    params = $.extend(params, context_params);
                }
                obj[fn](params);
            } else {
                var slice = Array.prototype.slice;
                var theArgs = slice.apply(arguments);
                if (context_params) {
                    theArgs.push(context_params);
                }
                obj[fn].apply(obj, theArgs);
            }
        }
    },

    // returns a function that is suitable for triggering by an event, and which will
    // call the specified function (fn) on the specified object (obj) with the element
    // which fired the event as the argument
    //
    // if "conditional" is specified, this is a function (which can take the event as an argument)
    // which is called to determine whether the event will propagate to the object function.
    //
    // so, for example
    //
    // eventClosure(this, "handler")(event)
    // results in a call to
    // this.handler(element)
    //
    // and
    //
    // eventClosure(this, "handler", function(event) { return event.type === "click" })(event)
    // results in a call (only in the case that the event is a click), to
    // this.handler(element)
    //
    eventClosure : function(obj, fn, conditional) {
        return function(event) {
            if (conditional) {
                if (!conditional(event)) {
                    return;
                }
            }

            event.preventDefault();
            obj[fn](this);
        }
    },

    //////////////////////////////////////////////////////////////////
    // CSS normalising/canonicalisation tools

    css_classes : function(namespace, field, renderer) {
        var cl = namespace + "-" + field;
        if (renderer) {
            cl += " " + cl + "-" + renderer.component.id;
        }
        return cl;
    },

    css_class_selector : function(namespace, field, renderer) {
        var sel = "." + namespace + "-" + field;
        if (renderer) {
            sel += sel + "-" + renderer.component.id;
        }
        return sel;
    },

    css_id : function(namespace, field, renderer) {
        var id = namespace + "-" + field;
        if (renderer) {
            id += "-" + renderer.component.id;
        }
        return id;
    },

    css_id_selector : function(namespace, field, renderer) {
        return "#" + edges.css_id(namespace, field, renderer);
    },

    //////////////////////////////////////////////////////////////////
    // Event binding utilities

    on : function(selector, event, caller, targetFunction, delay, conditional) {
        // if the caller has an inner component (i.e. it is a Renderer), use the component's id
        // otherwise, if it has a namespace (which is true of Renderers or Templates) use that
        if (caller.component && caller.component.id) {
            event = event + "." + caller.component.id;
        } else if (caller.namespace) {
            event = event + "." + caller.namespace;
        }

        // create the closure to be called on the event
        var clos = edges.eventClosure(caller, targetFunction, conditional);

        // now bind the closure directly or with delay
        // if the caller has an inner component (i.e. it is a Renderer) use the components jQuery selector
        // otherwise, if it has an inner, use the selector on that.
        if (delay) {
            if (caller.component) {
                caller.component.jq(selector).bindWithDelay(event, clos, delay);
            } else if (caller.edge) {
                caller.edge.jq(selector).bindWithDelay(event, clos, delay);
            } else {
                console.log("attempt to bindWithDelay on caller which has neither inner component or edge")
            }
        } else {
            if (caller.component) {
                caller.component.jq(selector).on(event, clos)
            } else if (caller.edge) {
                caller.edge.jq(selector).on(event, clos)
            } else {
                console.log("attempt to bindWithDelay on caller which has neither inner component or edge")
            }
        }
    },

    //////////////////////////////////////////////////////////////////
    // Shared utilities

    escapeHtml : function(unsafe, def) {
        if (def === undefined) {
            def = "";
        }
        if (unsafe === undefined || unsafe == null) {
            return def;
        }
        try {
            if (typeof unsafe.replace !== "function") {
                return unsafe
            }
            return unsafe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        } catch(err) {
            return def;
        }
    },

    objVal : function(path, rec, def) {
        if (def === undefined) {
            def = false;
        }
        var bits = path.split(".");
        var val = rec;
        for (var i = 0; i < bits.length; i++) {
            var field = bits[i];
            if (field in val) {
                val = val[field];
            } else {
                return def;
            }
        }
        return val;
    },

    getParam : function(value, def) {
        return value !== undefined ? value : def;
    }
};
