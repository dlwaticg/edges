$.extend(!0,edges,{bs3:{newBasicRangeSelectorRenderer:function(e){return e||(e={}),edges.bs3.BasicRangeSelectorRenderer.prototype=edges.newRenderer(e),new edges.bs3.BasicRangeSelectorRenderer(e)},BasicRangeSelectorRenderer:function(e){this.hideEmptyRange=void 0===e.hideEmptyRange?!0:e.hideEmptyRange,this.open=e.open||!1,this.showSelected=e.showSelected||!0,this.namespace="edges-bs3-basic-range-selector",this.draw=function(){var e="Loading...",s=edges.css_classes(this.namespace,"result",this),t=edges.css_classes(this.namespace,"value",this),i=edges.css_classes(this.namespace,"filter-remove",this),a=edges.css_classes(this.namespace,"facet",this),n=edges.css_classes(this.namespace,"header",this),o=edges.css_id(this.namespace,"toggle",this),c=edges.css_id(this.namespace,"results",this);if(this.component.values.length>0&&(e="",0===this.component.filters.length))for(var l=0;l<this.component.values.length;l++){var h=this.component.values[l];(h.count>0||!this.hideEmptyRange)&&(e+='<div class="'+s+'"><a href="#" class="'+t+'" data-from="'+h.from+'" data-to="'+h.to+'">'+edges.escapeHtml(h.display)+"</a> ("+h.count+")</div>")}var d="";if(this.component.filters.length>0&&this.showSelected)for(var l=0;l<this.component.filters.length;l++){var r=this.component.filters[l];d+='<div class="'+s+'"><strong>'+edges.escapeHtml(r.display)+"&nbsp;",d+='<a href="#" class="'+i+'" data-from="'+r.from+'" data-to="'+r.to+'">',d+='<i class="glyphicon glyphicon-black glyphicon-remove"></i></a>',d+="</strong></a></div>"}var p='<div class="'+a+'">                        <div class="'+n+'"><div class="row">                             <div class="col-md-12">                                <a href="#" id="'+o+'"><i class="glyphicon glyphicon-plus"></i>&nbsp;'+edges.escapeHtml(this.component.display)+'</a>                            </div>                        </div></div>                        <div class="row" style="display:none" id="'+c+'">                            <div class="col-md-12">                                {{SELECTED}}                                {{RESULTS}}                            </div>                        </div></div>';p=p.replace(/{{RESULTS}}/g,e).replace(/{{SELECTED}}/g,d),this.component.context.html(p),this.setUIOpen();var g=edges.css_id_selector(this.namespace,"toggle",this),m=edges.css_class_selector(this.namespace,"value",this),v=edges.css_class_selector(this.namespace,"filter-remove",this);edges.on(g,"click",this,"toggleOpen"),edges.on(m,"click",this,"rangeSelected"),edges.on(v,"click",this,"removeFilter")},this.setUIOpen=function(){var e=edges.css_id_selector(this.namespace,"results",this),s=edges.css_id_selector(this.namespace,"toggle",this),t=this.component.jq(e),i=this.component.jq(s);this.open?(i.find("i").removeClass("glyphicon-plus").addClass("glyphicon-minus"),t.show()):(i.find("i").removeClass("glyphicon-minus").addClass("glyphicon-plus"),t.hide())},this.toggleOpen=function(e){this.open=!this.open,this.setUIOpen()},this.rangeSelected=function(e){var s=this.component.jq(e).attr("data-from"),t=this.component.jq(e).attr("data-to");this.component.selectRange(parseFloat(s),parseFloat(t))},this.removeFilter=function(e){var s=this.component.jq(e).attr("data-from"),t=this.component.jq(e).attr("data-to");this.component.removeFilter(parseFloat(s),parseFloat(t))}}}});