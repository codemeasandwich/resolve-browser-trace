var path = require("path");
const HtmlWebpackPlugin = require('html-webpack-plugin');
const ScribblesWithGitInBundle = require('scribbles/gitStatus');
var webpack = require('webpack');

module.exports = {
  entry: "./app.jsx",
  target:"web",
  devtool: 'source-map',
  output: {
    path: path.join(__dirname+ "/../output"),
    filename: "public/[name]-[hash].min.js",
    sourceMapFilename: 'private/[name]-[hash].map.js'
  },
  plugins: [
      ScribblesWithGitInBundle,
      new HtmlWebpackPlugin({
        filename:"index.html",
        templateContent:'<!DOCTYPE html><html><head></head><body></body></html>'
      }),
      new webpack.optimize.UglifyJsPlugin({sourceMap:true})
  ],
  module:{
    loaders:[{
                test: /\.jsx$/,
                loader:"babel-loader",
                exclude:"/node_modules/",
                query:{
                    presets:["react", "es2015"]
                }
            }]
    }
}
