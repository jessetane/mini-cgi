#!/usr/bin/env node

import net from 'net'
import http from 'http'
import ecstatic from 'ecstatic'
import cp from 'child_process'

const host = process.env.HOST || '::1'
const port = process.env.PORT || '8080'
const root = process.env.ROOT || '.'
const autoIndex = process.env.AUTO_INDEX

const statics = ecstatic(root, {
	cache: 'no-cache',
	showDir: process.env.SHOW_DIR ? true : false,
	mime: {
		'application/javascript': ['js', 'mjs']
	}
})

const httpServer = http.Server()
httpServer.maxRequestsPerSocket = 1
httpServer.on('request', async (req, res) => {
	console.log('static:', req.method, req.url)
	return statics(req, res, () => {
		req.url = '/'
		res.statusCode = 200
		statics(req, res)
	})
})

const server = net.Server()

server.on('connection', socket => {
	socket.setNoDelay(true)
	socket.on('error', err => {
		console.error('socket error:', err)
	})
	socket.once('data', firstPacket => {
		const headers = firstPacket.toString('ascii')
		let nl = headers.indexOf('\r\n\r\n') > -1 ? '\r\n' : '\n'
		let [_, method, url] = headers.match(/([^\s]+?) ([^\s]+?) HTTP/)
		if (!url) {
			console.error('strange request:', headers)
			socket.end('HTTP/1.1 500 Server Error' + nl + nl + 'server error')
			return
		}
		socket.unshift(firstPacket)
		const urlParts = url.split('?')
		const queryString = urlParts.slice(1).join('?')
		let pathname = urlParts[0] = urlParts[0].split('/').filter(c => c !== '..').join('/')
		url = urlParts.join('?')
		if (pathname === '/') pathname = '/' + autoIndex
		if (pathname.match(/\.cgi\b/i)) {
			console.log('cgi:', url, pathname)
			try {
				const handler = cp.spawn(root + pathname, [], {
					env: {
						GATEWAY_INTERFACE: 'CGI/1.1',
						REQUEST_METHOD: method,
						REQUEST_URI: url,
						QUERY_STRING: queryString,
						SCRIPT_NAME: pathname
					}
				})
				socket.pipe(handler.stdin)
				let output = ''
				handler.stdout.on('data', d => output += d)
				handler.stderr.on('data', d => console.error(d.toString()))
				handler.on('exit', (code, err) => {
					if (code !== 0) {
						console.error('cgi: process exited nonzero:', code, err)
						tryToSendServerError(err)
						return
					}
					nl = output.indexOf('\r\n\r\n') > -1 ? '\r\n' : '\n'
					const endOfHeaders = output.indexOf(nl + nl)
					const headers = output.slice(0, endOfHeaders).split(nl)
					const body = output.slice(endOfHeaders + nl.length * 2)
					headers[0] = headers[0].replace(/^Status: (.*)/, 'HTTP/1.1 $1')
					// workaround for incorrect content-type
					if (body.match(/^<\?xml/i)) {
						headers.find((h, i) => {
							if (h.match(/content-type: /i)) {
								headers[i] = headers[i].replace('text/html', 'application/xhtml+xml')
							}
						}) 
					}
					const response = headers.join(nl) + nl + nl + body
					socket.end(response)
				})
				handler.on('error', err => {
					console.error('cgi: process saw error', err)
					tryToSendServerError(err)	
				})
			} catch (err) {
				console.error('cgi: failed to spawn process:', err)
				tryToSendServerError(err)
			}
		} else {
			httpServer.emit('connection', socket)
		}
	})
})

server.listen(port, host, err => {
	if (err) throw err
	console.log(`http server listening at ${host}:${port}`)
})

function tryToSendServerError (socket, err) {
	try {
		socket.end('HTTP/1.1 500 Server Error\r\n\r\nserver error')
	} catch (err) {
		console.error('cgi: failed to respond with error:', err)
	}
}
