const stackTraceParser = require('stacktrace-parser');
const fs = require('fs');

// https://github.com/mozilla/source-map/issues/432#issuecomment-751791344
const fetch = global.fetch;
global.fetch = undefined;
const SourceMapConsumer = require("source-map").SourceMapConsumer;
global.fetch = fetch;

function setup(whereClientMapFileLive) {

    const shaMapLookUp = {}

    return (stackString,sha) => {

        const stackLines = stackString.split("\n")

        const rawStack = stackTraceParser.parse(stackString)

        if( ! sha){
          // http://localhost:3000/public/ ->main-29a5d7571ba82f2e63c0<- .min.js:1:9562
          sha = rawStack[0].file.split("/").pop()
                                .split(".")[0]
        }
        const work = lookup => {
          return rawStack.map((rawLineInfo,index)=>{

            // {file,methodName,arguments,lineNumber,column}

           const [ fromLine, fromCol ] = stackLines[index].split(":")
                                                          .splice(-2)
                                                          .map(val => val.replace(/[^\d]/g, ""))

           // This is to fix a dug where stacktrace-parser is not parcing Chrome traces right
           if ( ! stackLines[index].includes(`:${rawLineInfo.lineNumber}:${rawLineInfo.column}`)
               && stackLines[index].includes(`:${fromLine}:${fromCol}`)){
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

           rawLineInfo.toString = ()=>stackLines[index]

           const result = {
                from:rawLineInfo,
                source:sourceInfo.source.replace("webpack:///",""),
                line:sourceInfo.line,
                column:sourceInfo.column,
                name:sourceInfo.name
            }

           const cleanLine = stackLines[index].replace(rawLineInfo.file,result.source)
                                   .replace(`:${rawLineInfo.lineNumber}:${rawLineInfo.column}`,
                                            `:${result.line}:${result.column}`)
                                   .replace(result.name ? `${rawLineInfo.methodName || ""}@` : "",
                                            result.name ? `${result.name}@` : "")
                                   .replace(result.name ? `at ${rawLineInfo.methodName || ""}` : "",
                                            result.name ? `at ${result.name}` : "")
            result.toString = ()=>cleanLine

            return result

          })
        } // END work

        return new Promise((resolve,reject)=>{
            if (shaMapLookUp[sha]) {
                shaMapLookUp[sha].then(work).then(resolve)
            } else {
                fs.readdir( whereClientMapFileLive, (err, files) => {
                    const findMap = files.filter(file =>file.includes(".map"))
                                         .find(file =>file.includes(sha))

                    if ( ! findMap) {
                       return resolve(work(null))
                    }

                    fs.readFile(whereClientMapFileLive+"/"+findMap,'utf8',(err, sourceMapData) => {
                        shaMapLookUp[sha] = new SourceMapConsumer(JSON.parse(sourceMapData));
                        shaMapLookUp[sha].then(work).then(resolve)
                    });
                }) // END fs.readdir
            } // END else
        }) // END new Promise
    } // END
} // END setup
module.exports = setup
