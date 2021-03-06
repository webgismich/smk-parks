include.module( 'viewer', [ 'jquery', 'util', 'event', 'layer', 'feature-set', 'query' ], function () {

    var ViewerEvent = SMK.TYPE.Event.define( [
        'changedView',
        'changedBaseMap',
        'startedLoading',
        'finishedLoading',
        'startedIdentify',
        'finishedIdentify',
        'pickedLocation',
        'changedLocation',
        'changedPopup'
    ] )

    function Viewer() {
        var self = this

        ViewerEvent.prototype.constructor.call( this )

        var loading = false
        Object.defineProperty( this, 'loading', {
            get: function () { return loading },
            set: function ( v ) {
                if ( !!v == loading ) return
                // console.log( 'viewer', v )
                loading = !!v
                if ( v )
                    self.startedLoading()
                else
                    self.finishedLoading()
            }
        } )
    }

    SMK.TYPE.Viewer = Viewer

    $.extend( Viewer.prototype, ViewerEvent.prototype )
    // _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _
    //
    Viewer.prototype.basemap = {
        Topographic: {
            order: 1,
            title: 'Topographic'
        },
        Streets: {
            order: 2,
            title: 'Streets'
        },
        Imagery: {
            order: 3,
            title: 'Imagery'
        },
        Oceans: {
            order: 4,
            title: 'Oceans'
        },
        NationalGeographic: {
            order: 5,
            title: 'National Geographic'
        },
        ShadedRelief: {
            order: 6,
            title: 'Shaded Relief'
        },
        DarkGray: {
            order: 7,
            title: 'Dark Gray'
        },
        Gray: {
            order: 8,
            title: 'Gray'
        },
        // Terrain: {
        //     order: 9,
        //     title: 'Terrain'
        // },
    }
    // _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _
    //
    // for(s=1;s<25;s++){v.map.setZoom(s,{animate:false});console.log(s,v.getScale())}
    Viewer.prototype.zoomScale = []
    Viewer.prototype.zoomScale[  1 ] = 173451547.7127784
    Viewer.prototype.zoomScale[  2 ] = 89690013.7670628
    Viewer.prototype.zoomScale[  3 ] = 45203253.08071528
    Viewer.prototype.zoomScale[  4 ] = 22617698.02495323
    Viewer.prototype.zoomScale[  5 ] = 11314385.218894083
    Viewer.prototype.zoomScale[  6 ] = 5659653.605577067
    Viewer.prototype.zoomScale[  7 ] = 2829913.245708334
    Viewer.prototype.zoomScale[  8 ] = 1414856.836779603
    Viewer.prototype.zoomScale[  9 ] = 707429.7690058348
    Viewer.prototype.zoomScale[ 10 ] = 353715.05331990693
    Viewer.prototype.zoomScale[ 11 ] = 176857.5477505768
    Viewer.prototype.zoomScale[ 12 ] = 88428.77649887519
    Viewer.prototype.zoomScale[ 13 ] = 44214.496444883276
    Viewer.prototype.zoomScale[ 14 ] = 22107.221783884223
    Viewer.prototype.zoomScale[ 15 ] = 11053.61708610345
    Viewer.prototype.zoomScale[ 16 ] = 5526.806585855153
    Viewer.prototype.zoomScale[ 17 ] = 2763.4019883053297
    Viewer.prototype.zoomScale[ 18 ] = 1381.6944712225031
    Viewer.prototype.zoomScale[ 19 ] = 690.8367988270104

    Viewer.prototype.getZoomBracketForScale = function ( scale ) {
        if ( scale > this.zoomScale[ 1 ] ) return [ 0, 1 ]
        if ( scale < this.zoomScale[ 19 ] ) return [ 19, 20 ]
        for ( var z = 2; z < 20; z++ )
            if ( scale > this.zoomScale[ z ] ) return [ z - 1, z ]
    }
    // _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _
    //
    Viewer.prototype.destroy = function () {
        ViewerEvent.prototype.destroy()
    }

    Viewer.prototype.initialize = function ( smk ) {
        var self = this

        this.lmfId = smk.lmfId
        this.type = smk.viewer.type
        this.disconnected = smk.$option.disconnected
        this.serviceUrl = smk.$option[ 'service-url' ]

        this.identified = new SMK.TYPE.FeatureSet()
        this.selected = new SMK.TYPE.FeatureSet()
        this.searched = new SMK.TYPE.FeatureSet()
        this.queried = {} // new SMK.TYPE.FeatureSet()

        this.layerIds = []
        this.layerId = {}
        this.visibleLayer = {}
        this.layerIdPromise = {}
        this.deadViewerLayer = {}
        this.pickHandlers = []
        this.query = {}

        this.screenpixelsToMeters = self.pixelsToMillimeters( 100 ) / 1000

        if ( Array.isArray( smk.layers ) )
            constructLayers( smk.layers, 0, null, function ( ly, cfg ) {
                // console.log( 'layer', ly.index, ly.id );

                self.layerIds.push( ly.id )
                self.layerId[ ly.id ] = ly

                ly.startedLoading( function () {
                    self.loading = true
                } )

                ly.finishedLoading( function () {
                    self.loading = self.anyLayersLoading()
                } )

                if ( cfg.queries )
                    cfg.queries.forEach( function ( q ) {
                        var query = new SMK.TYPE.Query[ cfg.type ]( ly.id, q )

                        self.query[ query.id ] = query
                        self.queried[ query.id ] = new SMK.TYPE.FeatureSet()
                    } )
            } )

        this.pickedLocation( function ( ev ) {
            var chain = SMK.UTIL.resolved()

            return self.pickHandlers.reduceRight( function ( chain, hs, i ) {
                if ( !hs || hs.length == 0 ) return chain

                return chain.then( function ( handled ) {
                    // console.log( handled, i )
                    if ( handled ) return true

                    return Promise.all( hs.map( function ( h ) {
                        return SMK.UTIL.resolved().then( function () {
                            return h.call( self, ev )
                        } )
                    } ) )
                    .then( function ( handleds ) {
                        // console.log( handleds, i )
                        return handleds.some( function ( h ) { return h } )
                    } )
                } )
            }, SMK.UTIL.resolved() )
                .catch( function ( e ) {
                    console.warn( e )
                } )
        } )

        function constructLayers( layerConfigs, index, parentId, cb ) {
            layerConfigs.forEach( function ( layerConfig, i ) {
                index = constructLayer( layerConfig, index, parentId, cb )
            } )

            return index
        }

        function constructLayer( layerConfig, index, parentId, cb ) {
            var id = ( parentId ? parentId + '==' : '' ) + layerConfig.id

            try {
                if ( !( layerConfig.type in SMK.TYPE.Layer ) )
                    throw new Error( 'layer type "' + layerConfig.type + '" not defined' )

                if ( !( smk.viewer.type in SMK.TYPE.Layer[ layerConfig.type ] ) )
                    throw new Error( 'layer type "' + layerConfig.type + '" not defined for viewer "' + smk.viewer.type + '"' )

                var ly = new SMK.TYPE.Layer[ layerConfig.type ][ smk.viewer.type ]( layerConfig )
                ly.initialize( id, index, parentId )
            }
            catch ( e ) {
                e.message += ', when creating layer id "' + id + '"'
                throw e
            }

            cb( ly, layerConfig )

            if ( !ly.hasChildren() )
                return index + 1

            return constructLayers( ly.childLayerConfigs(), index + 1, ly.id, cb )
        }
    }

    Viewer.prototype.initializeLayers = function ( smk ) {
        var self = this;

        if ( !smk.layers || smk.layers.length == 0 ) return SMK.UTIL.resolved()

        return self.setLayersVisible( self.layerIds.filter( function ( id ) { return self.layerId[ id ].config.isVisible } ), true )
            .catch( function () {} )
    }

    Viewer.prototype.handlePick = function ( priority, handler ) {
        if ( !this.pickHandlers[ priority ] ) this.pickHandlers[ priority ] = []

        this.pickHandlers[ priority ].push( handler )
    }
    // _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _
    //
    Viewer.prototype.filterLayers = function ( predicate ) {
        var self = this

        return this.layerIds
            .filter( function ( id ) {
                return predicate( self.layerId[ id ] )
            } )
            .map( function ( id ) {
                return self.layerId[ id ]
            } )
    }

    Viewer.prototype.isLayerVisible = function ( layerId ) {
        var ly = this.layerId[ layerId ]
        if ( !ly.parentId ) return ly.visible
        return this.layerId[ ly.parentId ].visible && ly.visible
    }

    Viewer.prototype.childLayers = function ( layerId ) {
        if ( !this.layerId[ layerId ].isContainer ) return []

        return this.filterLayers( function ( ly ) { return ly.parentId == layerId } )
    }

    Viewer.prototype.setLayersVisible = function ( layerIds, visible ) {
        var self = this

        var layerCount = this.layerIds.length
        if ( layerCount == 0 ) return SMK.UTIL.resolved()

        if ( layerIds.every( function ( id ) { return !self.isLayerVisible( id ) == !visible } ) ) return SMK.UTIL.resolved()

        var pending = {}
        self.layerIds.forEach( function ( id ) {
            pending[ id ] = true
        } )
        Object.keys( self.visibleLayer ).forEach( function ( id ) {
            pending[ id ] = true
        } )

        layerIds.forEach( function ( id ) {
            var ly = self.layerId[ id ]

            var prev = ly.visible
            ly.visible = !!visible

            if ( visible && ly.parentId )
                self.layerId[ ly.parentId ].visible = true

            self.childLayers( id ).forEach( function ( ly ) { ly.visible = visible } )
        } )

        var visibleLayers = []
        var merged
        this.layerIds.forEach( function ( id, i ) {
            // console.log( id,self.isLayerVisible( id ),self.layerId[ id ].isContainer,self.layerId[ id ].config );
            if ( !self.isLayerVisible( id )  ) return
            if ( self.layerId[ id ].isContainer ) return

            ly = self.layerId[ id ]
            if ( !merged ) {
                merged = [ ly ]
                return
            }

            if ( merged[ 0 ].canMergeWith( ly ) ) {
                merged.push( ly )
                return
            }

            visibleLayers.push( merged )
            merged = [ ly ]
        } )
        if ( merged )
            visibleLayers.push( merged )

        var promises = []
        var maxZOrder = visibleLayers.length - 1
        visibleLayers.forEach( function ( lys, i ) {
            var cid = lys.map( function ( ly ) { return ly.id } ).join( '##' )

            delete pending[ cid ]
            if ( self.visibleLayer[ cid ] ) {
                self.positionViewerLayer( ly, maxZOrder - i )
                return
            }

            var p = self.createViewerLayer( cid, lys, maxZOrder - i )
                .then( function ( ly ) {
                    self.addViewerLayer( ly )
                    self.positionViewerLayer( ly, maxZOrder - i )
                    self.visibleLayer[ cid ] = ly
                    return ly
                } )

            promises.push( p )
        } )

        Object.assign( this.deadViewerLayer, pending )

        if ( promises.length == 0 )
            self.finishedLoading()

        return SMK.UTIL.waitAll( promises )
    }

    Viewer.prototype.addViewerLayer = function ( viewerLayer ) {
    }

    Viewer.prototype.positionViewerLayer = function ( viewerLayer, zOrder ) {
    }

    Viewer.prototype.createViewerLayer = function ( id, layers, zIndex ) {
        var self = this

        if ( layers.length == 0 )
            throw new Error( 'no layers' )

        var type = layers[ 0 ].config.type

        if ( !layers.every( function ( c ) { return c.config.type == type } ) )
            throw new Error( 'types don\'t match' )

        if ( this.layerIdPromise[ id ] )
            return this.layerIdPromise[ id ]

        if ( !SMK.TYPE.Layer[ type ][ self.type ].create )
            return SMK.UTIL.rejected( new Error( 'can\'t create viewer layer of type "' + type + '"' ) )

        return this.layerIdPromise[ id ] = SMK.UTIL.resolved()
            .then( function () {
                try {
                    return SMK.TYPE.Layer[ type ][ self.type ].create.call( self, layers, zIndex )
                }
                catch ( e ) {
                    console.warn( 'failed to create viewer layer', layers, e )
                    return SMK.UTIL.rejected( e )
                }
            } )
            .then( function ( ly ) {
                return self.afterCreateViewerLayer( id, type, layers, ly )
            } )
    }

    Viewer.prototype.afterCreateViewerLayer = function ( id, type, layers, viewerLayer ) {
        viewerLayer._smk_type = type
        viewerLayer._smk_id = id

        return viewerLayer
    }
    // _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _
    //
    Viewer.prototype.getView = function () {
        throw new Error( 'not implemented' )
    }

    Viewer.prototype.identifyFeatures = function ( location, option ) {
        var self = this

        option = Object.assign( {
            tolerance: 5
        }, option )

        var view = this.getView()

        var searchArea = turf.polygon( [ SMK.UTIL.circlePoints( location.screen, option.tolerance, 12 ).map( function ( p ) { return self.screenToMap( p ) } ) ] )

        // var searchArea = turf.circle( [ location.map.longitude, location.map.latitude ], option.tolerance * view.metersPerPixelAtY( location.screen.y ) / 1000 )

        this.startedIdentify( { area: searchArea, location: location.map } )

        this.identified.clear()

        var promises = []
        this.layerIds.forEach( function ( id, i ) {
            var ly = self.layerId[ id ]

            if ( !ly.visible ) return
            if ( ly.config.isQueryable === false ) return
            if ( !ly.inScaleRange( view ) ) return

            option.layer = self.visibleLayer[ id ]

            var p = ly.getFeaturesInArea( searchArea, view, option )
            // var p = ly.getFeaturesAtPoint( location, view, option )
            if ( !p ) return

            promises.push(
                SMK.UTIL.resolved().then( function () {
                    return p
                } )
                .then( function ( features ) {
                    features.forEach( function ( f, i ) {
                        if ( ly.config.titleAttribute ) {
                            var m = ly.config.titleAttribute.match( /^(.+?)(:[/](.+)[/])?$/ )
                            if ( m ) {
                                if ( !m[ 2 ] )
                                    f.title = f.properties[ m[ 1 ] ]
                                else
                                    try {
                                        f.title = f.properties[ m[ 1 ] ].match( new RegExp( m[ 3 ] ) )[ 1 ]
                                    }
                                    catch ( e ) {
                                        console.warn( e, m )
                                    }
                            }
                        }

                        if ( !f.title )
                            f.title = 'Feature #' + ( i + 1 )

                        return f
                    } )

                    return features
                } )
                .then( function ( features ) {
                    features.forEach( function ( f ) {
                        f._identifyPoint = location.map
                    } )
                    self.identified.add( id, features )
                } )
                .catch( function ( err ) {
                    console.debug( id, 'identify fail:', err.message )
                    return SMK.UTIL.resolved()
                } )
            )
        } )

        return SMK.UTIL.waitAll( promises )
            .then( function () {
                self.finishedIdentify()
            } )
    }
    // _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _
    //
    Viewer.prototype.anyLayersLoading = function () {
        var self = this

        return this.layerIds.some( function ( id ) {
            return self.layerId[ id ].loading
        } )
    }
    // _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _
    //
    Viewer.prototype.resolveAttachmentUrl = function ( url, id, type ) {
        if ( url && url.startsWith( '@' ) ) {
            id = url.substr( 1 )
            url = null
        }

        if ( url )
            return url

        if ( !id )
            throw new Error( 'attachment without URL or Id' )

        if ( this.disconnected )
            return 'attachments/' + id + ( type ? '.' + type : '' )
        else
            return this.serviceUrl + '/MapConfigurations/' + this.lmfId + '/Attachments/' + id
    }
    // _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _
    //
    Viewer.prototype.pixelsToMillimeters = ( function () {
        var e = document.createElement( 'div' )
        e.style = 'height:1mm; display:none'
        e.id = 'heightRef'
        document.body.appendChild( e )

        var pixPerMillimeter = $( '#heightRef' ).height()

        e.parentNode.removeChild( e )

        return function ( pixels ) {
            return pixels / pixPerMillimeter
        }
    } )()
    // _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _
    //
    Viewer.prototype.getCurrentLocation = function ( option ) {
        var self = this

        option = Object.assign( {
            timeout:         10 * 1000,
            maxAge:     10 * 60 * 1000,
            cacheKey:   'smk-location'
        }, option )

        if ( this.currentLocationPromise && ( !this.currentLocationTimestamp || this.currentLocationTimestamp > ( ( new Date() ).getTime() - option.maxAge ) ) )
            return this.currentLocationPromise

        this.currentLocationTimestamp = null
        return this.currentLocationPromise = SMK.UTIL.makePromise( function ( res, rej ) {
            navigator.geolocation.getCurrentPosition( res, rej, {
                timeout:            option.timeout,
                enableHighAccuracy: true,
            } )
            setTimeout( function () { rej( new Error( 'timeout' ) ) }, option.timeout )
        } )
        .then( function ( pos ) {
            self.currentLocationTimestamp = ( new Date() ).getTime()
            window.localStorage.setItem( option.cacheKey, JSON.stringify( { latitude: pos.coords.latitude, longitude: pos.coords.longitude } ) )
            return pos.coords
        } )
        .catch( function ( err ) {
            try {
                var coords = JSON.parse( window.localStorage.getItem( option.cacheKey ) )
                if ( coords && coords.latitude ) {
                    console.warn( 'using cached location', coords )
                    return coords
                }
            }
            catch ( e ) {}
            return Promise.reject( err )
        } )
        .then( function ( loc ) {
            return SMK.UTIL.findNearestSite( loc )
                .then( function ( site ) {
                    site.current = true
                    return site
                } )
        } )
    }

} )