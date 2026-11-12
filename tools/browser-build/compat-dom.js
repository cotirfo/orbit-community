// DOM features missing from older television browsers; no network dependencies.
(function(){
  function append(){for(var i=0;i<arguments.length;i++){var child=arguments[i];this.appendChild(typeof child==='string'?document.createTextNode(child):child);}}
  function replaceChildren(){while(this.firstChild)this.removeChild(this.firstChild);append.apply(this,arguments);}
  [Element.prototype,Document.prototype,DocumentFragment.prototype].forEach(function(proto){if(!proto.append)proto.append=append;if(!proto.replaceChildren)proto.replaceChildren=replaceChildren;});
  if(!Element.prototype.matches)Element.prototype.matches=Element.prototype.msMatchesSelector||Element.prototype.webkitMatchesSelector;
  if(!Element.prototype.closest)Element.prototype.closest=function(selector){var node=this;while(node&&node.nodeType===1){if(node.matches(selector))return node;node=node.parentElement;}return null;};
  if(!Element.prototype.remove)Element.prototype.remove=function(){if(this.parentNode)this.parentNode.removeChild(this);};
  if(!window.CSS||!CSS.supports||!CSS.supports('display','grid'))document.documentElement.className+=' legacy-layout';
})();
