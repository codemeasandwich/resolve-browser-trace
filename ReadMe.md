# resolve-browser-trace

![n-is-not-defined](/imgs/notdefined.jpg)

A Server/Node library to rebuild client side stacktraces into source files

[![npm version](https://badge.fury.io/js/resolve-browser-trace.svg)](https://www.npmjs.com/package/resolve-browser-trace) [![License](http://img.shields.io/:license-apache_2-yellow.svg)](https://www.apache.org/licenses/LICENSE-2.0)


### If this was helpful, [★ it on github](https://github.com/codemeasandwich/resolve-browser-trace)

# Install

`yarn add resolve-browser-trace`
**or**
`npm install --save resolve-browser-trace`

### constructor / setup


The first step to import the lib
``` js
const setupResolveTrace = require('resolve-browser-trace')
```

Next is to set the path to where you store your map files for your bundles
``` js
const sourceDecoder = setupResolveTrace(__dirname+"/src/ .map files are here");
```

To use just pass 1) sha or hash name for your bundle and 2) the string stacktrace
``` js
sourceDecoder(sha,stack) // returns Promise
```

# Example

``` js
const sourceDecoder = require('resolve-browser-trace')(__dirname+"/src/ .map files are here")

const sha = "9adc196540168f060d54"
const clientStacktrack = `@https://localhost/main-9adc196540168f060d54.min.js:1:3385
@https://localhost/main-9adc196540168f060d54.min.js:1:96`;

sourceDecoder(sha,stack).then(newStack => console.log(newStack))
/*[
  {
    "from": {
      "file": "https://localhost/main-9adc196540168f060d54.min.js",
      "methodName": null,
      "arguments": [],
      "lineNumber": 1,
      "column": 3385
    },
    "source": "webpack:///main.jsx",
    "line": 20,
    "column": 21,
    "name": appElem
  },
  {
    "from": {
      "file": "file:///home/brian/www/redux-auto/example/dist/main-9adc196540168f060d54.min.js",
      "methodName": null,
      "arguments": [],
      "lineNumber": 1,
      "column": 96
    },
    "source": "webpack:///webpack/bootstrap 9adc196540168f060d54",
    "line": 19,
    "column": 0,
    "name": "modules"
  }
]*/
```

![bundled-trace-in-source-pointer-out](/imgs/inout.jpg)

# setup your webpack

webpack.config.js
```js 
module.exports = {
  // ...
  target:"web",
  devtool: 'source-map',
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name]-[hash].min.js"
  },
  // ...
```
