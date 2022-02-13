
# resolve-browser-trace

### When it comes to the stability of your web application, knowing when your **production users have a problem is critical**!

When we develop locally. We can have the convenience of a readable stacktrace to let you know what has happened.
However, with your live site, letting the whole world know how our source is constructed is not something we may want.

### The Problem:
**How can we get a useful stack trace from client-side errors without exposing the inner workings?**


### The Solution:
**Send the client Error & stack to the Server. Then get the server to clean up the stack-trace before it gets saved your logs for review.**

## resolve-browser-trace is a NodeJs library to rebuild client side stacktraces into source pointers

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

const sha = "9adc196540168f060d54" // What is hash
const clientStacktrack = `@https://localhost/main-9adc196540168f060d54.min.js:1:3385
@https://localhost/main-9adc196540168f060d54.min.js:1:96`;

sourceDecoder(sha,stack).then(newStack => console.log(newStack))
/* RESULT -> [
  {
    "from": {
      "file": "https://localhost/main-9adc196540168f060d54.min.js",
      "methodName": null,
      "arguments": [],
      "lineNumber": 1,
      "column": 3385,
      "toString": ()=>"@https://localhost/main-9adc196540168f060d54.min.js:1:3385"
    },
    "source": "webpack:///main.jsx",
    "line": 20,
    "column": 21,
    "name": appElem,
    "toString": ()=>"appElem@main.jsx:20:21"
  },
  {
    "from": {
      "file": "file:///home/brian/www/redux-auto/example/dist/main-9adc196540168f060d54.min.js",
      "methodName": null,
      "arguments": [],
      "lineNumber": 1,
      "column": 96,
      "toString": ()=>"@https://localhost/main-9adc196540168f060d54.min.js:1:96"
    },
    "source": "webpack:///webpack/bootstrap 9adc196540168f060d54",
    "line": 19,
    "column": 0,
    "name": "modules",
    "toString": ()=>"modules@webpack/bootstrap 9adc196540168f060d54:20:21"
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
    path: path.resolve(__dirname, "public"),
    filename: "[name]-[hash].min.js"
  },
  // ...
```




















