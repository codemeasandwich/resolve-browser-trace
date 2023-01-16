const stackTraceParser = require('stacktrace-parser');
const fs = require('fs');

// https://github.com/mozilla/source-map/issues/432#issuecomment-751791344
const fetch = global.fetch;
global.fetch = undefined;
const SourceMapConsumer = require("source-map").SourceMapConsumer;
global.fetch = fetch;

//+++++++++++++++++++++++++++++ get Sha From File Path
//++++++++++++++++++++++++++++++++++++++++++++++++++++

function getShaFromFilePath(filePath){
  // http://localhost:3000/public/ ->main-29a5d7571ba82f2e63c0<- .min.js:1:9562
  return filePath.split("/").pop().split(".")[0]
} // END getShaFromFilePath

//++++++++++++++++++++++++++ load a map file from disk
//++++++++++++++++++++++++++++++++++++++++++++++++++++

function loadMapFile(whereClientMapFileLive,sha){
      return new Promise((resolve,reject)=>{
              fs.readdir( whereClientMapFileLive, (err, files) => {
                  const findMap = files.filter(file =>file.includes(".map"))
                                       .find(file =>file.includes(sha))
                  if ( ! findMap) {
                     return resolve(null)
                  }
                  fs.readFile(whereClientMapFileLive+"/"+findMap,'utf8',(err, sourceMapData) => {
                    if(err){
                      reject(err)
                    } else {
                      resolve(new SourceMapConsumer(JSON.parse(sourceMapData)))
                    }
                  });
              }) // END fs.readdir
      }) // END new Promise
} // END loadMapFile


//++++++++++++++++++++++++++++++++ lookup Row map data
//++++++++++++++++++++++++++++++++++++++++++++++++++++

function lookupRow(rawLineInfo, stackLine, lookup){

              // {file,methodName,arguments,lineNumber,column}

             const [ fromLine, fromCol ] = stackLine.split(":")
                                                    .splice(-2)
                                                    .map(val => val ? val.replace(/[^\d]/g, "") : 0)

             // This is to fix a dug where stacktrace-parser is not parcing Chrome traces right
             if ( ! stackLine.includes(`:${rawLineInfo.lineNumber}:${rawLineInfo.column}`)
                 && stackLine.includes(`:${fromLine}:${fromCol}`)){
               rawLineInfo.lineNumber = +fromLine
               rawLineInfo.column = +fromCol
             }

             const sourceInfo = lookup ? lookup.originalPositionFor({
              line:rawLineInfo.lineNumber,
              column:rawLineInfo.column
              }) : {
              source:rawLineInfo.file,
              line:rawLineInfo.lineNumber,
              column:rawLineInfo.column,
              name:rawLineInfo.methodName.replace("<unknown>","")
             }

             // {source,line,column,name}
             Object.keys(rawLineInfo).forEach(key => {
              if ("<unknown>" === rawLineInfo[key]) {
                  rawLineInfo[key] = null
              }
             })

             const result = {
                //  from:rawLineInfo,          // source maybe Null
                  source:sourceInfo.source ? sourceInfo.source.replace("webpack:///","")
                                           : rawLineInfo.file,
                  line:sourceInfo.line,
                  arguments:rawLineInfo.arguments,
                  column:sourceInfo.column,
                  name:sourceInfo.name || undefined
              }
/*
                         rawLineInfo.toString = ()=>stackLine
             const cleanLine = stackLine.replace(rawLineInfo.file,result.source)
                                     .replace(`:${rawLineInfo.lineNumber}:${rawLineInfo.column}`,
                                              `:${result.line}:${result.column}`)
                                     .replace(result.name ? `${rawLineInfo.methodName || ""}@` : "",
                                              result.name ? `${result.name}@` : "")
                                     .replace(result.name ? `at ${rawLineInfo.methodName || ""}` : "",
                                              result.name ? `at ${result.name}` : "")
              result.toString = ()=>cleanLine
*/
              return result
}

//=====================================================
//=============================== resolve-browser-trace
//=====================================================

function setup(whereClientMapFileLive) {

    const shaMapLookUp = {}

    return (stackString) => {

        const stackLines = stackString.split("\n")

        const rawStack = stackTraceParser.parse(stackString)
        if (0 === rawStack.length) {
            return Promise.resolve([])
        }

        const shaFilesForEachLine = rawStack.map(({file})=>getShaFromFilePath(file))
        const needToLoad = shaFilesForEachLine.filter((v,i,a) => a.indexOf(v) == i && ! shaMapLookUp[v])

        needToLoad.forEach((sha) => {
          shaMapLookUp[sha] = loadMapFile(whereClientMapFileLive,sha)
        });

        return Promise.all(rawStack.map((rawLineInfo,lineCount)=>{
          return shaMapLookUp[shaFilesForEachLine[lineCount]].then(lookup=>lookupRow(rawLineInfo, stackLines[lineCount], lookup))
        }))

    } // END
} // END setup
module.exports = setup
