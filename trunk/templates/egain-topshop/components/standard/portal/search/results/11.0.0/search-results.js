define(['underscore',
        'core/component',
        'core/helpers'],

function(_, CoreComponent, helpers) {

    var SearchResultsComponent = CoreComponent.extend({

        name : "search-results",

        receiveActions : {

            "filter" : "onFilterAction",
            "search-type" : "onSearchTypeAction",
            "egain11.product.search.filter" : "onFilterAction",
            "egain11.product.search.type" : "onSearchTypeAction",
            "egain11.product.topic.filter" : "onTopicFilterAction",
            "egain11.product.search.refine" : "onSearchRefineAction"
        },

        events : {

            "mouseenter li" : "showPreviewOnHover",
            "mouseleave li" : "deletePreviewOnLeave",
            "click .js-load-more" : "onLoadMoreClick",
            "click .js-confirm-avoid-esc" : "onConfirmAvoidance",
            "click .js-cancel-avoid-esc" : "onCancelAvoidance",
            "click .js-web-item-click" : "onWebItemClick",
            "click .js-article-view-click" : "onArticleViewClick",
            "click .js-topic-view-click" : "onTopicViewClick"
        },
		articleShown : 0,
        prepare : function(){

            this.searchModel = this.getModel('search');
            this.articleModel = this.getModel('article');
            // try/catch is used for backward compatibility with an old manifest
            try {
                this.escalationModel = this.getModel('escalation');
            }
            catch(e) {
                if (console)
                    console.log("ERROR in search results component while loading escalation model. ", e.message);
            }

            this.limit = this.getProperty('limit', 5);
            this.skip = this.getProperty('skipped_results_count', 0);

			this.articleModel.getAnnouncements({
				success : this._onAnnouncementsArrive,
				error : this.declareError,
				limit : this.limit,
				context : this
			});

            var query = this.getProperty('query', 'mars');
            // strip html tags if any
            var decodedQuery = helpers.decodeHtml(query);

            /* If we end up with an empty query after stripping html tags
             * (there was some problem), use the original query */
            query = (decodedQuery) ? decodedQuery : query;

            //Get results, passing the query.
            this.getResults(query);
        },
		_onAnnouncementsArrive : function(data){
            this.announcements = _.map(data.announcements, function(announcement) {
                return announcement.id;
            }, this);
		},
		declareError : function(){

		},

		/**
         *  Performs a search based on the query.
         */
        getResults : function(query){

            query = query || this._current_query;

            if(query) {

                if(this._isEscalationAvoidanceSearch()) {

                    // get contact us data saved by 'contact_us' component
                    var escalationData = this.getState('contactUsData', null, true);

                    if(!$.isEmptyObject(escalationData)) {
                        // escalation avoidance search
                        this.escalationModel.escalationAvoidanceSearch({

                            query : unescape(query),
                            success : this._onResultsArrive,
                            error: this._onEscalationSearchError,
                            context : this,
                            limit : this.limit,
                            skip : this.skip,
                            topicId : escalationData.topicId,
                            subject: escalationData.subject,
                            description: escalationData.body
                        });
                    }
                    // if we cannot retrieve contact us data, redirect back to 'contact_us' component
                    else {
                        this.onConfirmAvoidance();
                    }

                } else {

                    // Multi-Search
                    this.searchModel.multiSearch({

                        query : unescape(query),
                        refinementData : this.refinementData,
                        success : this._onResultsArrive,
                        context : this,
                        limit : this.limit,
                        skip : this.skip,
                        federated : true
                    });
                }

                this._current_query = query;

                //Save state
                this._saveLastQueryState(query);

            } else {

                var prompt = this.app.language.compileString('SEARCH_QUERY_PROMPT');
            	this.$el.html(prompt);
            }
        },

        /**
         * Renders this component when the search results arrive.
         */
        _onResultsArrive : function(data) {
			var _data = {
					article  : new Array(),
					pagingInfo : {
						maxRange : data.pagingInfo.maxRange
					}
			};
			_.each(data.article, function(article) {
				if(jQuery.inArray(article.id, this.announcements)==-1){
					_data.article.push(article);
				}else{
					_data.pagingInfo.maxRange = _data.pagingInfo.maxRange- 1;
				}
			}, this);
			data.article = _data.article;
			data.pagingInfo.maxRange = _data.pagingInfo.maxRange;

            // If it's an escalation avoidance search and the search results are empty, submit the escalation
            if(this._isEscalationAvoidanceSearch() && (!data.article || data.article.length==0) &&
               (!data.topic || data.topic.length==0) && (!data.forumPost || data.forumPost.length==0)) {
                this.onConfirmAvoidance();
                return;
            }

        	this.results_data = data;
            this._processResults(data);
			this.articleShown += data.article.length;

            //Pass the search results to the template.
            this.render({
                results : data,
                query : data.query,
                show_load_more : this._shouldShowLoadMore(data.pagingInfo.maxRange),
                isEscalationAvoidanceSearch : this._isEscalationAvoidanceSearch()
            });
        },

        /**
         * Adds additional attributes necessary for rendering to article objects from search results.
         */
        _processResults : function(data) {

            data.article = _.map(data.article, function(article) {

                if(!article.textMetadata) {
                    article.articleIcon = 'icon-file';
                    return article;
                }

                //Snippet character ranges
                var highlightMetadata = article.textMetadata.highlightMetadata;
                for (var i = 0; i < highlightMetadata.length; i++) {

                	if (highlightMetadata[i].attributeName == 'snippet') {
                		var snippetCRs = highlightMetadata[i].characterRange;
                	}
                }

                if (snippetCRs != 'undefined') {
                	article.snippet = helpers.highlightText(article.snippet, snippetCRs);
                }
                if(!this.app.getPortalSetting('crmDomain') && article.searchScore)
                {
               		article.searchScoreRounded = (article.searchScore * 100).toFixed(2);
                }

               	if (article.articleType == 1) {
               		article.articleIcon = "icon-map-marker";
               	}
               	else {
               		article.articleIcon = "icon-file";
               	}

                return article;

            }, this);
        },

        /**
         * If escalation avoidance search returned an error, just submit the
         * escalation request.
         */
        _onEscalationSearchError : function() {
            this.onConfirmAvoidance();
        },

        /**

        onFilterAction
        This function is triggered by the 'filter' action.
        It takes whatever data that is passed through the filter action, and mixes it to its current filter state. After that, it fires another search request based on the new filter state and show the updated search results to the users.

        //On filter : Gets the filter criteria and recomputes
        the search results.
        **/

        onFilterAction : function(val1, val2) {

            this.$("h1:first").append('filtered!');
        },

        /**
        This function is triggered by the 'search-type' action. That action is usually triggered when a user is currently typing in a search bar.

        //On search type : Updates the search results as the typing goes.
        **/
        onSearchTypeAction : function(value){

            console.log('typing');
            //If the instant search is turned on,
	        //then run the get results function.
            if(this.getProperty('instant-search')) {

                this.getResults(value);
            }
        },

        onSearchRefineAction : function(refinementData) {

        	this.refinementData = refinementData;
        	this.getResults();
        },

        onTopicFilterAction : function(topic_id) {

            this._setTopicFilterId(topic_id);

            this.getResults();
        },

        _setTopicFilterId : function(topic_id) {

            this._topic_id_filter = topic_id;
        },

        showPreviewOnHover : function(e) {

            if(!this.getProperty('show_preview'))
                return;

            var $li = $(e.currentTarget);

            if($li.find('.preview').length > 0) {
                e.stopPropagation();
                return;
            }

            this._showPreview($li);
        },

        _showPreview : function($li) {

            //Get the data from the results
            //data, retrieved by the index of the LI.
            var data = this.results_data[$li.index()];
            var $preview = this._createPreview(data);

            //Calculate the right distance to the browser edge.
            var right_offset = $li.offset().left + $li.outerWidth();


            console.log("SHOW PREVIEW");

            //TODO : fix this.
            $preview.css({

                left : right_offset - 400 + "px",
                top : $li.parents('.component:first').offset().top,
                width : (right_offset - 530) + "px"
                //height : ($(window).height() - $li.siblings('li').first().offset().top - 50) + "px"
            });

            $li.parent().append($preview);
        },

        _createPreview : function(data) {

            //TODO : abstract this template
            var tpl_preview = "<div class='preview'><small>ARTICLE PREVIEW</small><h1>{{name}}</h1><p>{{{content}}}</p></div>";
            var $preview = $(this.compile(tpl_preview, data));

            return $preview;
        },

        deletePreviewOnLeave : function(e) {

            //Remove the preview div
            $(e.currentTarget).parent().find('.preview').remove();
        },

        /**
         * This function is called when a user clicks on "Load More" button.
         * It updates the 'skip' parameter which holds the number of results to be
         * skipped in the next search (explicitly skipped items plus the items already shown
         * to the user). Then a search request is submitted to get the next portion of
         * the serach results.
         */
        onLoadMoreClick : function() {

            this.skip += this.limit;

            // Multi-Search
            this.searchModel.multiSearch({

                query : unescape(this._current_query),
                success : this._onMoreResultsArrive,
                context : this,
                refinementData : this.refinementData,
                limit : this.limit,
                skip : this.skip

            }, this);
        },

        /**
         * This fucntion is used when additional results arrive after a user clicks on
         * "Load More" button.
         */
        _onMoreResultsArrive : function(data) {
            // additional processing (adding icons, ratings, highlighting etc)
        	this._processResults(data);


            // append a divider
        	this.$('ul.js-portal').append(this.compileTemplate('divider', {
                'top_entry_count' : this.articleShown
            }));

			this.articleShown += data.article.length;

            // hide "Load More" button if these are the last of the results
        	if(!this._shouldShowLoadMore(data.pagingInfo.maxRange)) {
                this.$('.js-load-more').hide();
            }

            // append topics first below existing portal results
        	//_.each(data.topic, function(topic) {
           //     this.$('ul.js-portal').append(this.compileTemplate('topic-row', topic));
           // }, this);

            // append articles
        	_.each(data.article, function(article) {
                this.$('ul.js-portal').append(this.compileTemplate('article-row', article));
            }, this);
        },

        /**
         * Given the total count of KB search results, determines whether we should show "Load more" button
         * based on the number of results already shown.
         */
        _shouldShowLoadMore : function(actual_count) {

           // return actual_count > (this.skip + this.limit);
            return actual_count > this.articleShown;
        },

        /**
         * Builds a full URL to a given article or topic
         */
        buildArticleOrTopicUrl : function(entity, type) {

            var pageName;
            if(type == 'article') {
                pageName = this.getProperty('article_page');
            } else {
                pageName = this.getProperty('topic_page');
            }

            var queryObject = {
                fromQuery : this._current_query
            };
            return this.app.getPageUrl(pageName, entity.id, this.slugify(entity.name), queryObject);
        },

        /**
         * Builds a search request URL with a given query string.
         */
        buildSearchUrl : function(queryString) {

        	// we currently strip '%' character from the search string
        	if(queryString.indexOf('%') != -1)
        		queryString = queryString.replace('%', '');

        	return this.app.getPageUrl(this.getProperty('search_page'), queryString);
        },

        _saveLastQueryState : function(lastQuery) {

            this.saveState('lastQuery', lastQuery);
        },

        _isEscalationAvoidanceSearch : function() {

            return parseInt(this.page.getQueryString('escalationAvoidance')) === 1;
        },

        onConfirmAvoidance : function() {

            this.navigateToPage('contact_us', {'noprompt': 1});
        },

        onCancelAvoidance : function() {

            // if escalation model was loaded properly, log an escalation cancellation event
            if(this.escalationModel) {

                this.escalationModel.avertEscalation({
                    context : this
                    // there are no success/error handlers because there is no action required,
                    // this API call just logs an 'avert escalation' event
                });
            }

            this.$('.avoidance-block').hide();
        },

        /**
         * This function is called when a user clicks on web or intranet search result.
         * It makes a WS call to log a viewing event.
         */
        onWebItemClick : function(e) {

            var $inputTarget = $(e.target);

            // parse the search result url and event type from the data-link attribute
            var accessLink = $inputTarget.attr('data-link');
            var accessQueryStr = accessLink.split('?')[1];
            if (!accessQueryStr)
                return;

            var linkAccessObject = helpers.parseQueryString(accessQueryStr);

            this.searchModel.getWebItemUrl({
                context : this,
                data : {
                    url : linkAccessObject.url,
                    type : linkAccessObject.type
                }
                // there are no success/error handlers because there is no action required,
                // the API call just logs a search result viewing event
            });
        },

		/** Save this article view context in the browser */
        onArticleViewClick : function(e) {
             // in case of escalation avoidance search, article view context is 'viewing suggested articles'
             if(this._isEscalationAvoidanceSearch()) {
                 this.saveState('articleViewContext', 'article_view_suggested', true);
             }
             // this is a normal search, so article view context is 'viewing basic search results'
             else {
                this.saveState('articleViewContext', 'article_view_basic_search', true);
             }
        },

		/** Save this topic view context in the browser */
        onTopicViewClick : function(e) {
             this.saveState('topicViewContext', 'topic_tree_click_topic', true);
        }


    });

    return SearchResultsComponent;
});
