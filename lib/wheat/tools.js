var Step = require('step'),
    Haml = require('haml'),
    Jade = require('jade'),
    Markdown = require('./markdown'),
    Crypto = require('crypto'),
    Buffer = require('buffer').Buffer,
    Git = require('git-fs'),
    datetime = require('datetime');

function md5sum(data) {
  var hash = Crypto.createHash('md5');
  hash.update(data);
  return hash.digest('hex');
}

var Helpers = {
  inspect: require(process.binding('natives').util ? 'util' : 'sys').inspect,
  intro: function intro(markdown) {
    var html = Markdown.encode(markdown);
    return html.substr(0, html.indexOf("<h2"));
  },
  markdownEncode: function markdownEncode(markdown) {
    return Markdown.encode(markdown+"");
  },
  github: function github(name) {
    return '<a href="http://github.com/' + name + '">' + name + '</a>';
  },
  bitbucket: function bitbucket(name) {
    return '<a href="http://bitbucket.com/' + name + '">' + name + '</a>';
  },
  twitter: function twitter(name) {
    return '<a href="http://twitter.com/' + name + '">' + name + '</a>';
  },
  gravitar: function gravitar(email, size) {
    size = size || 200;
    var md5 = md5sum((email+"").trim().toLowerCase())
    return "http://www.gravatar.com/avatar/" +
      md5 + "?r=pg&s=" + size + ".jpg&d=identicon";
  },
  formatDate: function formatDate(val, format, tz, locale) {
    return datetime.format(new Date(val), format, tz, locale);
  },
  formatRFC822Date: function formatRFC822Date(val) {
    return datetime.format(new Date(val), "%a, %d %b %Y %H:%M:%S %z");
  },
  render: function(name) {
    var list = this._torender;
    if (list.indexOf(name) < 0) {
      list.push(name);
    }
    return "{{" + md5sum(name) + "}}";
  }

};

// Convert UTF8 strings to binary buffers for faster loading
function stringToBuffer(string) {
  var buffer = new Buffer(Buffer.byteLength(string));
  buffer.write(string, 'utf8');
  return buffer;
};

var jadeOptions = {
  compileDebug: false
};

// Loads a haml or jade template.
var loadTemplate = Git.safe(function loadTemplate(version, name, callback) {
  Step(
    function loadJade() {
      Git.readFile(version, "skin/" + name + ".jade", this);
    },
    function loadHaml(err, jade) {
      if (err) {
        Git.readFile(version, "skin/" + name + ".haml", this);
      } else {
        return {
          jade: jade
        };
      }
    },
    function compileTemplate(err, hamlOrJade) {
      if (err) { callback(err); return; }
      if (hamlOrJade.jade) {
        return Jade.compile(hamlOrJade.jade + "", jadeOptions);
      } else {
        return Haml(hamlOrJade + "", (/\.xml$/).test(name));
      }
    },
    callback
  );
});

var getHead = function() {
  Git.getHead(this);
};

// Like loadTemplate, but doesn't require the version
function compileTemplate(name, callback) {
  Step(
    getHead,
    function loadTemplates(err, version) {
      if (err) { callback(err); return; }
      loadTemplate(version, name, this);
    },
    function (err, template) {
      if (err) { callback(err); return; }
      return function (data) {
        data.__proto__ = Helpers;
        return template.apply(this, arguments);
      };
    },
    callback
  );
};

function renderTemplateWithIncludes(templateFunction, data, callback) {
  data.__proto__ = Helpers;
  data._torender = [];
  var resolveOne = function(err, text) {
    if (err) { callback(err); return; }
    var aname = data._torender.shift();
    if (typeof(aname) === "undefined") {
      // We're done!
      callback(null, text);
    } else {
      Step(
        getHead,
        function loadTemplates(err, version) {
          if (err) { callback(err); return; }
          loadTemplate(version, aname, this);
        },
        function replace(err, tf) {
          if (err) { callback(err); return; }
          var includedText = tf(data);
          var token = "{{" + md5sum(aname) + "}}";
          return text.replace(new RegExp(token, "g"), includedText);
        },
        resolveOne
      );
    }
  };
  var text = templateFunction(data);
  resolveOne(null, text);
}

function render(name, data, callback, partial) {
  Step(
    getHead,
    function loadTemplates(err, version) {
      if (err) { callback(err); return; }
      loadTemplate(version, name, this.parallel());
      if (!partial) {
        loadTemplate(version, "layout", this.parallel());
      }
    },
    function renderTemplates(err, template, layout) {
      if (err) { callback(err); return; }
      var that = this;
      renderTemplateWithIncludes(template, data, function(err, content) {
        if (err) { callback(err); return; }
        if (partial) {
          that(null, content);
        } else {
          data = {
            content: content,
            title: data.title || ""
          };
          renderTemplateWithIncludes(layout, data, that);
        }
      });
    },
    function toBuffer(err, content) {
      return stringToBuffer(content);
    },
    callback
  )
}

module.exports = {
  stringToBuffer: stringToBuffer,
  compileTemplate: compileTemplate,
  render: render
};
