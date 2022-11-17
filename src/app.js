
import http from 'http';
import io from 'socket.io';
import express from 'express';
import morgan from 'morgan';

export const app = express();

app.use(morgan('common'));
app.use(bodyParser.urlencoded({extended: true}));