// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'
import defaultView from '../views/defaultView.vue'
import projectsView from '../views/projectsView.vue'
import projectReviewView from '../views/projectReviewView.vue'
import infoView from '../views/infoView.vue'
import settingsView from '../views/settingsView.vue'

const routes = [
  {
    path: '/',
    name: 'home',
    component: defaultView
  },
  {
    path: '/projects',
    name: 'projects',
    component: projectsView
  },
  {
    path: '/projects/:id/review',
    name: 'projectReview',
    component: projectReviewView,
    props: true
  },
  {
    path: '/projects/:id',
    name: 'projectDetail',
    component: projectsView,
    props: true
  },
  {
    path: '/info',
    name: 'info',
    component: infoView
  },
  {
    path: '/settings',
    name: 'settings',
    component: settingsView
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
