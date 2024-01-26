# mini-cgi
Simple CGI server

## Why
Wanted something quick to serve gitweb and figured I'd see how our grandparents made websites.

## How
[node.js](https://nodejs.org)'s built-in tcp, http and child_process libraries.

## Example
``` shell
$ cd mini-cgi
$ npm install
$ ROOT=example AUTO_INDEX=index.cgi node index.js
```

## License
MIT
