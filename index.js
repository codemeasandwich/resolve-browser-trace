const stackTraceParser = require('stacktrace-parser');
const fs = require('fs'); 
const SourceMapConsumer = require("source-map").SourceMapConsumer;

function setup(whereClientMapFileLive) {
    
    const shaMapLookUp = {}
    
    return (sha,stackString) => {
        
        const rawStack = stackTraceParser.parse(stackString)
        
        const work = lookup => {
          return rawStack.map(rawLineInfo=>{
            
            // {file,methodName,arguments,lineNumber,column}
            
           const sourceInfo = lookup ? lookup.originalPositionFor({
            line:rawLineInfo.lineNumber,
            column:rawLineInfo.column
            }) : {
            source:null,
            line:null,
            column:null,
            name:null
           }
           // {source,line,column,name}
           Object.keys(rawLineInfo).forEach(key => {
            if ("<unknown>" === rawLineInfo[key]) {
                rawLineInfo[key] = null
            }
           })
           return {
                from:rawLineInfo,
                source:sourceInfo.source,
                line:sourceInfo.line,
                column:sourceInfo.column,
                name:sourceInfo.name
            }
          })
        } // END work
        
        return new Promise((resolve,reject)=>{
            if (shaMapLookUp[sha]) {
                shaMapLookUp[sha].then(work).then(resolve)
            } else {
                fs.readdir( whereClientMapFileLive, (err, files) => {
                    const findMap = files.filter(file =>file.endsWith(".map"))
                                         .find(file =>file.includes(sha))
                    
                    if ( ! findMap) {
                       return resolve(work(null))
                    }
                    
                    fs.readFile(whereClientMapFileLive+"/"+findMap,(err, sourceMapData) => {
                        shaMapLookUp[sha] = new SourceMapConsumer(JSON.parse(sourceMapData));
                        shaMapLookUp[sha].then(work).then(resolve)
                    });
                }) // END fs.readdir
            } // END else
        }) // END new Promise
    } // END
} // END setup
module.exports = setup