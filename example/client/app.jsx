import React from 'preact'
import { render } from 'preact'

const reactElement = document.createElement('div');
document.body.appendChild(reactElement);

let errorVal;

function foo(){
    throw new RangeError("an error on the client")
}

try{
    foo()
} catch(err){
  errorVal = err
  fetch("/api/error", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name:err.name,
      message:err.message,
      stack:err.stack,
      __scribbles_gitStatus__})
  });
}

render(<div>
    <h1>Check server console for Clear Error trace</h1>
    <p>{
        errorVal.stack.split("\n")
                 .map((line,index) => <div key={index}
                                           style={{color: "red"}}>{
                                        line
                                      }</div>)
    }</p>
</div>,reactElement)
