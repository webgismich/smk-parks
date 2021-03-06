include.module( 'smk-map', [ 'jquery', 'util' ], function () {

    function SmkMap( option ) {
        this.$option = option

        this.$dispatcher = new Vue()
    }

    SMK.TYPE.SmkMap = SmkMap

    SmkMap.prototype.initialize = function () {
        var self = this;

        console.groupCollapsed( 'SMK initialize #' + this.$option[ 'container-id' ] )

        console.log( 'options:', JSON.parse( JSON.stringify( this.$option ) ) )

        this.$container = document.getElementById( this.$option[ 'container-id' ] )
        if ( !this.$container )
            throw new Error( 'Unable to find container #' + this.$option[ 'container-id' ] )

        $( this.$container )
            .addClass( 'smk-hidden' )

        return SMK.UTIL.promiseFinally(
            SMK.UTIL.resolved()
                .then( loadConfigs )
                .then( mergeConfigs )
                .then( resolveConfig )
                .then( initMapFrame )
                .then( loadSurround )
                .then( checkTools )
                .then( loadViewer )
                .then( loadTools )
                .then( initViewer )
                .then( initTools )
                .then( initSurround )
                .then( showMap ),
            function () {
                console.groupEnd()
            }
        )

        // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

        function loadConfigs() {
            return SMK.UTIL.waitAll( self.$option.config.map( function ( c ) {
                if ( !c.url )
                    return SMK.UTIL.resolved( c )

                var id = c.url.toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^[-]|[-]$/g, '' )
                var tag = 'config-' + id
                include.tag( tag, { loader: 'template', url: c.url } )

                return include( tag )
                    .then( function ( inc ) {
                        try {
                            var obj = JSON.parse( inc[ tag ] )
                            obj.$sources = c.$sources
                            return obj
                        }
                        catch ( e ) {
                            console.warn( c.$sources[ 0 ], inc[ tag ] )
                            e.parseSource = c.$sources[ 0 ]
                            throw e
                        }
                    } )
            } ) )
        }

        function mergeConfigs( configs ) {
            var config = Object.assign( {}, SMK.CONFIG )
            config.$sources = []

            console.log( 'base', JSON.parse( JSON.stringify( config ) ) )

            while( configs.length > 0 ) {
                var c = configs.shift()

                console.log( 'merging', JSON.parse( JSON.stringify( c ) ) )

                mergeSurround( config, c )
                mergeViewer( config, c )
                mergeTools( config, c )
                mergeLayers( config, c )

                config.$sources = config.$sources.concat( c.$sources || '(unknown)' )
                delete c.$sources

                Object.assign( config, c )

                console.log( 'merged', JSON.parse( JSON.stringify( config ) ) )
            }

            Object.assign( self, config )

            // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

            function mergeSurround( base, merge ) {
                if ( !merge.surround ) return

                if ( base.surround ) {
                    if ( base.surround.subtitles && merge.surround.subtitles ) {
                        base.surround.subtitles = base.surround.subtitles.concat( merge.surround.subtitles )
                        delete merge.surround.subtitles
                    }

                    Object.assign( base.surround, merge.surround )
                }
                else {
                    base.surround = merge.surround
                }

                delete merge.surround
            }

            function mergeViewer( base, merge ) {
                if ( !merge.viewer ) return

                if ( base.viewer ) {
                    Object.assign( base.viewer, merge.viewer )
                }
                else {
                    base.viewer = merge.viewer
                }

                delete merge.viewer
            }


            function mergeTools( base, merge ) {
                return mergeCollection( base, merge, 'tools', {
                    findFn: function ( merge ) {
                        return function ( base ) {
                            return ( merge.type == base.type || merge.type == '*' ) &&
                                ( !merge.instance || merge.instance == base.instance )
                        }
                    },
                    mergeFn: function ( base, merge ) {
                        if ( merge.type && merge.type == '*' ) {
                            var m = JSON.parse( JSON.stringify( merge ) )
                            delete m.type
                            Object.assign( base, m )
                        }
                        else {
                            Object.assign( base, merge )
                        }
                    }
                } )
            }

            function mergeLayers( base, merge ) {
                return mergeCollection( base, merge, 'layers', {
                    findFn: function ( merge ) {
                        return function ( base ) {
                            return merge.id == base.id || merge.id.startsWith( '*' )
                        }
                    },
                    mergeFn: function ( baseLayer, mergeLayer ) {
                        mergeCollection( baseLayer, mergeLayer, 'queries', {
                            mergeFn: function ( baseQuery, mergeQuery ) {
                                mergeCollection( baseQuery, mergeQuery, 'parameters', {} )

                                Object.assign( baseQuery, mergeQuery )
                            }
                        } )

                        if ( mergeLayer.id == '**' && !mergeLayer.layers )
                            mergeLayer.layers = [ JSON.parse( JSON.stringify( mergeLayer ) ) ]

                        mergeLayers( baseLayer, mergeLayer )

                        if ( mergeLayer.id && mergeLayer.id.startsWith( '*' ) ) {
                            var m = JSON.parse( JSON.stringify( mergeLayer ) )
                            delete m.id
                            Object.assign( baseLayer, m )
                        }
                        else {
                            Object.assign( baseLayer, mergeLayer )
                        }
                    }
                } )
            }

            function mergeCollection( base, merge, prop, arg ) {
                var findFn = arg[ 'findFn' ] || function ( merge ) {
                    return function ( base ) {
                        return merge.id == base.id
                    }
                }

                var mergeFn = arg[ 'mergeFn' ] || function ( base, merge ) {
                    Object.assign( base, merge )
                }

                if ( !merge[ prop ] ) return

                if ( base[ prop ] ) {
                    merge[ prop ].forEach( function( m ) {
                        var items = base[ prop ].filter( findFn( m ) )
                        if ( items.length > 0 ) {
                            items.forEach( function ( item ) {
                                mergeFn( item, m )
                            } )
                        }
                        else {
                            base[ prop ].push( m )
                        }
                    } )
                }
                else {
                    base[ prop ] = merge[ prop ]
                }

                delete merge[ prop ]
            }

        }

        function resolveConfig() {
            if ( !self.layers ) return

            return SMK.UTIL.waitAll( self.layers.map( function ( ly ) {
                if ( ly.type != 'esri-dynamic' ) return ly
                if ( ly.dynamicLayers ) return ly
                if ( !ly.mpcmId ) throw new Error( 'No mpcmId provided' )

                return SMK.UTIL.makePromise( function ( res, rej ) {
                    $.ajax( {
                        url: 'https://mpcm-catalogue.api.gov.bc.ca/catalogV2/PROD/' + ly.mpcmId,
                        dataType: 'xml'
                    } ).then( res, rej )
                } )
                .then( function ( data ) {
                    debugger
                } )
                // console.log( ly )

            } ) )
        }

        function initMapFrame() {
            $( self.$container )
                .addClass( 'smk-map-frame' )
                .addClass( 'smk-viewer-' + self.viewer.type )
        }

        function loadSurround() {
            if ( !self.$option.standalone ) return

            return include( 'surround' )
        }

        function checkTools() {
            if ( !self.tools ) return
            var enabledTools = self.tools.filter( function ( t ) { return t.enabled !== false } )
            if ( enabledTools.length == 0 ) return

            return SMK.UTIL.waitAll( enabledTools.map( function ( t ) {
                return include( 'check-' + t.type )
                    .then( function ( inc ) {
                        console.log( 'checked tool "' + t.type + '"' )
                    } )
                    .catch( function ( e ) {
                        console.debug( 'unable to check tool "' + t.type + '"', e )
                    } )
            } ) )
        }

        function loadViewer() {
            return include( 'viewer-' + self.viewer.type )
                .catch( function ( e ) {
                    e.message += ', viewer type ' + ( self.viewer.type ? '"' + self.viewer.type + '" ' : '' ) + 'is not defined'
                    throw e
                    // throw new Error( 'viewer type ' + ( self.viewer.type ? '"' + self.viewer.type + '" ' : '' ) + 'is not defined' )
                } )
        }

        function loadTools() {
            self.$tool = {}

            if ( !self.tools ) return
            var enabledTools = self.tools.filter( function ( t ) { return t.enabled !== false } )
            if ( enabledTools.length == 0 ) return

            return SMK.UTIL.waitAll( enabledTools.map( function ( t ) {
                var tag = 'tool-' + t.type
                return include( tag )
                    .then( function ( inc ) {
                        return include( tag + '-' + self.viewer.type )
                            .catch( function () {
                                console.log( 'tool "' + t.type + '" has no ' + self.viewer.type + ' subclass' )
                            } )
                            .then( function () {
                                return inc
                            } )
                    } )
                    .then( function ( inc ) {
                        var id = t.type + ( t.instance ? '--' + t.instance : '' )
                        self.$tool[ id ] = new inc[ tag ]( t )
                        self.$tool[ id ].id = id
                    } )
                    .catch( function ( e ) {
                        console.warn( 'tool "' + t.type + '" failed to create:', e )
                    } )
            } ) )
        }

        function initViewer() {
            if ( !( self.viewer.type in SMK.TYPE.Viewer ) )
                throw new Error( 'viewer type "' + self.viewer.type + '" not defined' )

            self.$viewer = new SMK.TYPE.Viewer[ self.viewer.type ]()
            return SMK.UTIL.resolved()
                .then( function () {
                    return self.$viewer.initialize( self )
                } )
                .then( function () {
                    return self.$viewer.initializeLayers( self )
                } )
        }

        function initTools() {
            var ts = Object.keys( self.$tool )
                .sort( function ( a, b ) { return self.$tool[ a ].order - self.$tool[ b ].order } )

            return SMK.UTIL.waitAll( ts.map( function ( t ) {
                return SMK.UTIL.resolved()
                    .then( function () {
                        return self.$tool[ t ].initialize( self )
                    } )
                    .catch( function ( e ) {
                        console.warn( 'tool "' + t + '" failed to initialize:', e )
                    } )
                    .then( function ( tool ) {
                        console.log( 'tool "' + t + '" initialized' )
                    } )
            } ) )
        }

        function initSurround() {
            if ( !self.$option.standalone ) return

            self.$surround = new SMK.TYPE.Surround( self )
        }

        function showMap() {
            $( self.$container )
                .removeClass( 'smk-hidden' )
                .hide()
                .fadeIn( 1000 )

            if ( self.viewer.activeTool in self.$tool )
                self.$tool[ self.viewer.activeTool ].active = true
        }
    }

    SmkMap.prototype.destroy = function () {
        if ( this.$viewer )
            this.$viewer.destroy()
    }

    SmkMap.prototype.addToContainer = function ( html, attr, prepend ) {
        return $( html )[ prepend ? 'prependTo' : 'appendTo' ]( this.$container ).attr( attr || {} ).get( 0 )
    }

    SmkMap.prototype.addToOverlay = function ( html ) {
        if ( !this.$overlay )
            this.$overlay = this.addToContainer( '<div class="smk-overlay">' )

        return $( html ).appendTo( this.$overlay ).get( 0 )
    }

    SmkMap.prototype.addToStatus = function ( html ) {
        if ( !this.$status )
            this.$status = this.addToOverlay( '<div class="smk-status">' )

        return $( html ).appendTo( this.$status ).get( 0 )
    }

    SmkMap.prototype.getToolbar = function () {
        var self = this

        if ( this.$toolbar ) return this.$toolbar

        return this.$toolbar = include( 'toolbar' )
            .then( function ( inc ) {
                return new SMK.TYPE.Toolbar( self )
            } )
    }

    SmkMap.prototype.getSidepanel = function () {
        var self = this

        if ( this.$sidepanel ) return this.$sidepanel

        return this.$sidepanel = include( 'sidepanel' )
            .then( function ( inc ) {
                return new SMK.TYPE.Sidepanel( self )
            } )
    }

    SmkMap.prototype.emit = function ( toolId, event, arg ) {
        this.$dispatcher.$emit( toolId + '.' + event, arg )

        return this
    }

    SmkMap.prototype.on = function ( toolId, handler ) {
        var self = this

        Object.keys( handler ).forEach( function ( k ) {
            self.$dispatcher.$on( toolId + '.' + k, handler[ k ] )
        } )

        return this
    }

    SmkMap.prototype.withTool = function ( toolId, action ) {
        var self = this

        if ( !this.$tool[ toolId ] ) return

        return action.call( this.$tool[ toolId ] )
    }

} )
