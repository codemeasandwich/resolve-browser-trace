
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

To use just pass the stacktrace
``` js
sourceDecoder(stack) // returns Promise
```

# Example

``` js
const sourceDecoder = require('resolve-browser-trace')(__dirname+"/src/ .map files are here")

const clientStacktrack = `@https://localhost/main-9adc196540168f060d54.min.js:1:3385
@https://localhost/main-9adc196540168f060d54.min.js:1:96`;

sourceDecoder(clientStacktrack).then(newStack => console.log(newStack))
/* RESULT -> [
  {
    "source": "main.jsx",
    "line": 20,
    "column": 21,
    "arguments": [],
    "name": appElem
  },
  {
    "source": "webpack/bootstrap 9adc196540168f060d54",
    "line": 19,
    "column": 0,
    "arguments": [],
    "name": "modules",
  }
]*/
```

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
